const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const http = require("node:http");
const { handleRequest } = require("../src/app");

let server;
let baseUrl;

before(async () => {
  server = http.createServer(handleRequest);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function nextCookie(response, current = "") {
  const value = response.headers.get("set-cookie");
  return value ? value.split(";", 1)[0] : current;
}

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, { redirect: "manual", ...options });
}

test("root exposes a framed legacy workspace", async () => {
  const response = await request("/");
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /<frameset/);
  assert.match(body, /\/app\/home/);
});

test("normal flow reads a balance and safely simulates a sub-account review", async () => {
  let cookie = "";
  let response = await request("/app/member-search", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "mbr_no_x7=100042&scope_cd=ALL"
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/app/member/100042");

  response = await request("/app/member/100042");
  cookie = nextCookie(response, cookie);
  assert.match(await response.text(), /Avery Example/);

  response = await request("/app/account?acct=S-0042-01", { headers: { cookie } });
  assert.match(await response.text(), /\$2,381\.37/);

  response = await request("/app/subaccount/start", {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: "member_ref=100042"
  });
  cookie = nextCookie(response, cookie);
  assert.equal(response.status, 303);

  response = await request("/app/subaccount/review", {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: "member_ref=100042&prod_x12=HOLIDAY_SAVINGS&memo_line_3=Winter+Fund&amt_1a=25.00&stmt_opt=E"
  });
  cookie = nextCookie(response, cookie);
  assert.equal(response.headers.get("location"), "/app/subaccount/review");

  response = await request("/app/subaccount/review", { headers: { cookie } });
  const review = await response.text();
  assert.match(review, /Final Review/);
  assert.match(review, /SIMULATION — NO CORE WRITE/);
  assert.doesNotMatch(review, /HUMAN REVIEW REQUIRED/);

  response = await request("/app/subaccount/simulate", { method: "POST", headers: { cookie } });
  const receipt = await response.text();
  assert.equal(response.status, 200);
  assert.match(receipt, /SIMULATED SUCCESS/);
  assert.match(receipt, /TRAIN-100042-002500/);
});

test("unknown member is an expected business outcome", async () => {
  const response = await request("/app/member/999999");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /BUSINESS RESULT N04/);
});

test("transient member lookup succeeds through its explicit retry", async () => {
  let response = await request("/app/member/100099");
  assert.equal(response.status, 503);
  assert.match(await response.text(), /RECOVERABLE HOST CONDITION T14/);

  response = await request("/app/member/100099?retry=1");
  const cookie = nextCookie(response);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Morgan Mockdata/);

  response = await request("/app/member/100099", { headers: { cookie } });
  assert.equal(response.status, 200);
});

test("hard failure inputs return distinct status and reason", async () => {
  const cases = [
    ["200017", 403, /SECURITY S17/],
    ["EXPIRED", 401, /SESSION E01/],
    ["APP-500", 500, /HOST X500/]
  ];
  for (const [member, status, pattern] of cases) {
    const response = await request(`/app/member/${member}`);
    assert.equal(response.status, status);
    assert.match(await response.text(), pattern);
  }
});

test("flagged member holds the same browser session for supervisor review", async () => {
  let response = await request("/app/subaccount/review", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "member_ref=300088&prod_x12=REGULAR_SAVINGS&memo_line_3=Reserve&amt_1a=50&stmt_opt=P"
  });
  let cookie = nextCookie(response);
  assert.equal(response.status, 303);

  response = await request("/app/subaccount/review", { headers: { cookie } });
  assert.match(await response.text(), /HUMAN REVIEW REQUIRED — HOLD H91/);

  response = await request("/app/subaccount/simulate", { method: "POST", headers: { cookie } });
  assert.equal(response.status, 409);

  response = await request("/app/subaccount/supervisor", { method: "POST", headers: { cookie } });
  cookie = nextCookie(response, cookie);
  assert.equal(response.status, 303);

  response = await request("/app/subaccount/review", { headers: { cookie } });
  const reviewed = await response.text();
  assert.doesNotMatch(reviewed, /HUMAN REVIEW REQUIRED/);
  assert.match(reviewed, /SIMULATE FINAL SUBMISSION/);
});

test("invalid account setup returns a validation business outcome", async () => {
  const response = await request("/app/subaccount/review", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "member_ref=100042&prod_x12=REGULAR_SAVINGS&amt_1a=-5&stmt_opt=E"
  });
  assert.equal(response.status, 422);
  assert.match(await response.text(), /VALIDATION V22/);
});

test("reset clears browser workflow state", async () => {
  const response = await request("/app/reset", { method: "POST" });
  assert.equal(response.status, 303);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});
