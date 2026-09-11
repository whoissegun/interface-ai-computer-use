const { URLSearchParams } = require("node:url");

const COOKIE_NAME = "northstar_demo_state";
const PRODUCTS = new Set(["REGULAR_SAVINGS", "HOLIDAY_SAVINGS", "YOUTH_SAVINGS"]);

const members = {
  "100042": {
    id: "100042",
    name: "Avery Example",
    address: "42 Fiction Lane, Sampleton, ON A1A 1A1",
    phone: "(555) 010-0042",
    status: "Active",
    joined: "2018-04-17",
    accounts: [
      { number: "S-0042-01", type: "Regular Savings", balance: "$2,481.37", available: "$2,381.37" },
      { number: "C-0042-08", type: "Chequing", balance: "$918.12", available: "$918.12" }
    ]
  },
  "100099": {
    id: "100099",
    name: "Morgan Mockdata",
    address: "99 Placeholder Road, Example Bay, ON B2B 2B2",
    phone: "(555) 010-0099",
    status: "Active",
    joined: "2021-11-03",
    accounts: [
      { number: "S-0099-02", type: "Regular Savings", balance: "$760.00", available: "$760.00" }
    ]
  },
  "300088": {
    id: "300088",
    name: "Casey Fiction",
    address: "8 Demonstration Court, Testville, ON C3C 3C3",
    phone: "(555) 010-0088",
    status: "Active — enhanced review flag",
    joined: "2024-06-21",
    reviewRequired: true,
    accounts: [
      { number: "S-0088-01", type: "Regular Savings", balance: "$10,500.00", available: "$10,500.00" }
    ]
  }
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf("=");
      return index === -1 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
    })
  );
}

function readState(req) {
  const encoded = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!encoded) return {};
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function stateCookie(state) {
  return `${COOKIE_NAME}=${Buffer.from(JSON.stringify(state)).toString("base64url")}; Path=/; HttpOnly; SameSite=Lax; Max-Age=14400`;
}

function clearStateCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(body);
}

function redirect(res, location, state) {
  const headers = { Location: location };
  if (state) headers["Set-Cookie"] = stateCookie(state);
  res.writeHead(303, headers);
  res.end();
}

function page(title, content, options = {}) {
  const tone = options.tone ? ` ${options.tone}` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Northstar CU</title>
  <link rel="stylesheet" href="/assets/legacy.css">
</head>
<body class="inner${tone}">
  <table class="titlebar" role="presentation"><tr><td><b>${escapeHtml(title)}</b></td><td class="right">COREBANK / TELLER 7.4</td></tr></table>
  ${content}
  <div class="footer">Northstar Community Credit Union — TRAINING SYSTEM — fictitious data only</div>
</body>
</html>`;
}

function shell() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Northstar CU CoreBank</title></head>
<frameset rows="72,*" frameborder="1" border="3">
  <frame src="/legacy-banner" name="banner" scrolling="no" title="Application banner">
  <frame src="/app/home" name="workspace" title="CoreBank workspace">
  <noframes><body><p>This training application requires frame support.</p><a href="/app/home">Open workspace</a></body></noframes>
</frameset>
</html>`;
}

function banner() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/legacy.css"><title>Northstar navigation</title></head>
<body class="banner"><table role="presentation"><tr><td class="brand">NORTHSTAR CU</td><td><a href="/app/home" target="workspace">HOME</a></td><td><a href="/app/member-search" target="workspace">MEMBER LOOKUP</a></td><td><a href="/app/help" target="workspace">OPS HELP</a></td><td class="right">BRANCH 019&nbsp; | &nbsp;USER: DEMO7</td></tr></table></body></html>`;
}

function homePage(state) {
  const resume = state.draft
    ? `<tr><td>Pending work</td><td>Sub-account setup for member ${escapeHtml(state.draft.memberId)}</td><td><a href="/app/subaccount/review">RESUME</a></td></tr>`
    : `<tr><td>Pending work</td><td>None</td><td>--</td></tr>`;
  return page("Operations Menu", `
    <div class="notice"><b>TRAINING ENVIRONMENT.</b> All people, balances, and transactions are fictional.</div>
    <table class="menu"><tr><th>Function</th><th>Description</th><th>Go</th></tr>
      <tr><td>MBR-10</td><td>Member inquiry and account balances</td><td><a href="/app/member-search">SELECT</a></td></tr>
      <tr><td>ACCT-22</td><td>New share/sub-account setup (simulation)</td><td><a href="/app/member-search">SELECT MEMBER</a></td></tr>
      ${resume}
    </table>
    <table class="status"><tr><th colspan="2">System Status</th></tr><tr><td>Host</td><td>ONLINE</td></tr><tr><td>Business date</td><td>09/11/2026</td></tr><tr><td>Queue</td><td>Normal</td></tr></table>
  `);
}

function memberSearchPage(message = "") {
  return page("MBR-10 Member Inquiry", `
    ${message}
    <form method="post" action="/app/member-search">
      <table class="formgrid" role="presentation">
        <tr><td class="label">Member Number</td><td><input name="mbr_no_x7" size="18" maxlength="16" autocomplete="off" autofocus></td></tr>
        <tr><td class="label">Search Scope</td><td><select name="scope_cd"><option value="ALL">All relationships</option><option value="DEPOSIT">Deposit only</option></select></td></tr>
        <tr><td></td><td><input type="submit" value="F6 - Locate"> <input type="reset" value="Clear"></td></tr>
      </table>
    </form>
    <p class="hint">Enter the full member number. Name search is unavailable during nightly indexing.</p>
    <p><a href="/app/home">F3 - Return to menu</a></p>
  `);
}

function memberPage(member) {
  const rows = member.accounts.map((account) => `<tr><td>${escapeHtml(account.number)}</td><td>${escapeHtml(account.type)}</td><td class="money">${escapeHtml(account.balance)}</td><td class="money">${escapeHtml(account.available)}</td><td><a href="/app/account?acct=${encodeURIComponent(account.number)}">INQUIRE</a></td></tr>`).join("");
  return page("Member Relationship Summary", `
    <table class="record"><tr><th>Member #</th><td>${member.id}</td><th>Status</th><td>${escapeHtml(member.status)}</td></tr>
      <tr><th>Name</th><td>${escapeHtml(member.name)}</td><th>Member since</th><td>${member.joined}</td></tr>
      <tr><th>Address</th><td colspan="3">${escapeHtml(member.address)}</td></tr><tr><th>Telephone</th><td colspan="3">${escapeHtml(member.phone)}</td></tr></table>
    ${member.reviewRequired ? `<div class="warning"><b>RELATIONSHIP ALERT R17:</b> A supervisor must review new-product requests for this member.</div>` : ""}
    <h2>Deposit Relationships</h2>
    <table class="accounts"><tr><th>Account</th><th>Product</th><th>Current Balance</th><th>Available Balance</th><th>Action</th></tr>${rows}</table>
    <form method="post" action="/app/subaccount/start"><input type="hidden" name="member_ref" value="${member.id}"><input type="submit" value="F9 - Open New Share/Sub-account"></form>
    <p><a href="/app/member-search">F4 - New member lookup</a></p>
  `);
}

function accountPage(member, account) {
  return page("Account Balance Inquiry", `
    <table class="record"><tr><th>Member</th><td>${member.id} — ${escapeHtml(member.name)}</td></tr><tr><th>Account</th><td>${escapeHtml(account.number)}</td></tr><tr><th>Product</th><td>${escapeHtml(account.type)}</td></tr><tr><th>Ledger balance</th><td class="money">${escapeHtml(account.balance)}</td></tr><tr class="highlight"><th>Available balance</th><td class="money"><b>${escapeHtml(account.available)}</b></td></tr></table>
    <p><a href="/app/member/${member.id}">F3 - Return to member</a></p>
  `);
}

function transientPage(memberId) {
  return page("Host Response Delayed", `
    <div class="warning"><b>RECOVERABLE HOST CONDITION T14</b><br>The relationship index did not answer before the teller timeout. No changes were made.</div>
    <table class="record"><tr><th>Requested member</th><td>${escapeHtml(memberId)}</td></tr><tr><th>Operator action</th><td>Wait briefly, then retry the same inquiry.</td></tr></table>
    <p><a class="button" href="/app/member/${encodeURIComponent(memberId)}?retry=1">F5 - Retry host request</a></p>
  `, { tone: "amber" });
}

function hardFailurePage(title, code, detail, status = 403) {
  return { status, body: page(title, `
    <div class="error"><b>${escapeHtml(code)}</b><br>${escapeHtml(detail)}</div>
    <p>The operation has stopped. Do not retry automatically.</p>
    <p><a href="/app/member-search">Return to member lookup</a></p>
  `, { tone: "red" }) };
}

function subaccountForm(member, values = {}, error = "") {
  return page("ACCT-22 New Share/Sub-account", `
    ${error ? `<div class="error"><b>VALIDATION V22</b><br>${escapeHtml(error)}</div>` : ""}
    <table class="record"><tr><th>Member</th><td>${member.id} — ${escapeHtml(member.name)}</td></tr><tr><th>Mode</th><td>PREPARE / NO POST</td></tr></table>
    <form method="post" action="/app/subaccount/review">
      <input type="hidden" name="member_ref" value="${member.id}">
      <table class="formgrid" role="presentation">
        <tr><td class="label">Product Code</td><td><select name="prod_x12"><option value="">-- choose --</option><option value="REGULAR_SAVINGS"${values.prod_x12 === "REGULAR_SAVINGS" ? " selected" : ""}>S01 - Regular Savings</option><option value="HOLIDAY_SAVINGS"${values.prod_x12 === "HOLIDAY_SAVINGS" ? " selected" : ""}>S14 - Holiday Savings</option><option value="YOUTH_SAVINGS"${values.prod_x12 === "YOUTH_SAVINGS" ? " selected" : ""}>S27 - Youth Savings</option></select></td></tr>
        <tr><td class="label">Account Nickname</td><td><input name="memo_line_3" maxlength="24" value="${escapeHtml(values.memo_line_3 || "")}"></td></tr>
        <tr><td class="label">Opening Deposit (CAD)</td><td><input name="amt_1a" inputmode="decimal" value="${escapeHtml(values.amt_1a || "0.00")}"></td></tr>
        <tr><td class="label">Statement Delivery</td><td><label><input type="radio" name="stmt_opt" value="E"${(!values.stmt_opt || values.stmt_opt === "E") ? " checked" : ""}> Electronic</label> <label><input type="radio" name="stmt_opt" value="P"${values.stmt_opt === "P" ? " checked" : ""}> Paper</label></td></tr>
        <tr><td></td><td><input type="submit" value="F8 - Continue to Review"> <a href="/app/member/${member.id}">Cancel</a></td></tr>
      </table>
    </form>
    <div class="smallprint">Amounts of CAD 5,000.00 or more and flagged relationships require human supervisor review.</div>
  `);
}

function reviewPage(state, member) {
  const draft = state.draft;
  const productLabels = { REGULAR_SAVINGS: "S01 - Regular Savings", HOLIDAY_SAVINGS: "S14 - Holiday Savings", YOUTH_SAVINGS: "S27 - Youth Savings" };
  const needsHuman = state.humanReviewRequired && !state.supervisorAcknowledged;
  const statusBlock = needsHuman
    ? `<div class="warning"><b>HUMAN REVIEW REQUIRED — HOLD H91</b><br>Reason: ${escapeHtml(state.reviewReason)}. Automation must stop here and leave this browser session open for an authorized supervisor.</div>
       <form method="post" action="/app/subaccount/supervisor"><input type="submit" value="Supervisor: acknowledge review"></form>`
    : `<div class="notice"><b>REVIEW CHECKPOINT.</b> Verify all fields. No account exists yet.</div>`;
  const simulationButton = needsHuman ? "" : `<form method="post" action="/app/subaccount/simulate" onsubmit="return confirm('TRAINING ONLY: simulate the final submission? No real account will be created.');"><input class="dangerbutton" type="submit" value="SIMULATE FINAL SUBMISSION"></form>`;
  return page("New Sub-account — Final Review", `
    ${statusBlock}
    <table class="record"><tr><th>Member</th><td>${member.id} — ${escapeHtml(member.name)}</td></tr><tr><th>Product</th><td>${escapeHtml(productLabels[draft.product])}</td></tr><tr><th>Nickname</th><td>${escapeHtml(draft.nickname || "(none)")}</td></tr><tr><th>Opening deposit</th><td>CAD ${Number(draft.amount).toFixed(2)}</td></tr><tr><th>Statements</th><td>${draft.statement === "P" ? "Paper" : "Electronic"}</td></tr><tr><th>Posting mode</th><td><b>SIMULATION — NO CORE WRITE</b></td></tr></table>
    ${simulationButton}
    <p><a href="/app/subaccount/new?member=${member.id}">F4 - Correct entry</a> &nbsp; <a href="/app/member/${member.id}">Cancel request</a></p>
  `, { tone: needsHuman ? "amber" : "" });
}

function receiptPage(state) {
  return page("Simulation Complete", `
    <div class="success"><b>SIMULATED SUCCESS</b><br>No account was opened and no funds moved.</div>
    <table class="record"><tr><th>Training reference</th><td>${escapeHtml(state.lastTrainingReference)}</td></tr><tr><th>Result</th><td>Review flow completed in safe simulation mode</td></tr></table>
    <p><a href="/app/home">Return to operations menu</a></p>
  `);
}

function helpPage() {
  return page("Operations Help / Demo Codes", `
    <p>This is a fictional training system. These stable inputs exist for repeatable automation demonstrations.</p>
    <table class="accounts"><tr><th>Input</th><th>Expected result</th><th>Classification</th></tr>
      <tr><td>100042</td><td>Normal member and full happy path</td><td>Success</td></tr>
      <tr><td>100099</td><td>First lookup shows timeout; Retry succeeds</td><td>Recoverable</td></tr>
      <tr><td>300088</td><td>New account review pauses for supervisor</td><td>Human intervention</td></tr>
      <tr><td>200017</td><td>User lacks access to relationship</td><td>Hard failure</td></tr>
      <tr><td>EXPIRED</td><td>Session-expired stop page</td><td>Hard failure</td></tr>
      <tr><td>APP-500</td><td>Simulated host fault with HTTP 500</td><td>Hard failure</td></tr>
      <tr><td>Any other value</td><td>Member not found</td><td>Expected business outcome</td></tr>
      <tr><td>Deposit ≥ 5000</td><td>Review pauses for supervisor</td><td>Human intervention</td></tr>
    </table>
    <form method="post" action="/app/reset"><input type="submit" value="Reset this browser's demo state"></form>
  `);
}

function assetCss() {
  return `html,body{font-family:Tahoma,Verdana,Arial,sans-serif;font-size:13px;background:#d8d8c8;color:#111;margin:0}body.inner{padding:8px 12px 38px}.banner{background:#123c55;color:#fff;overflow:hidden}.banner table{width:100%;height:68px;border-collapse:collapse}.banner td{padding:7px 15px;border-right:1px solid #8298a4}.banner a{color:#fff;font-weight:bold}.brand{font-family:Georgia,serif;font-size:24px;background:#08293c}.right{text-align:right}.titlebar{width:100%;background:#173f59;color:white;border:2px outset #80909a;margin-bottom:10px}.titlebar td{padding:5px 8px}.menu,.record,.accounts,.formgrid,.status{border-collapse:collapse;background:#eeeede;margin:10px 0;min-width:640px;box-shadow:1px 1px #777}.menu th,.menu td,.record th,.record td,.accounts th,.accounts td,.formgrid td,.status th,.status td{border:1px solid #73736a;padding:6px 8px}.menu th,.accounts th,.status th,.record th{background:#b4c3c8;text-align:left}.record th{width:150px}.label{background:#c8c8b8;font-weight:bold;text-align:right;width:210px}.money{text-align:right;font-family:'Courier New',monospace}.highlight{background:#fff7af}.notice,.warning,.error,.success{border:2px solid;margin:10px 0;padding:10px;max-width:760px}.notice{background:#e8f1f5;border-color:#225a75}.warning{background:#fff0a6;border-color:#a56b00}.error{background:#ffd5ce;border-color:#a40000}.success{background:#d8f2d0;border-color:#287718}input,select{font:inherit;border:2px inset #ddd;padding:3px;background:white}input[type=submit],input[type=reset],.button{border:2px outset #ddd;background:#d4d4c6;color:#111;padding:5px 10px;text-decoration:none;display:inline-block}.dangerbutton{background:#8e1d13!important;color:white!important;font-weight:bold}.footer{position:fixed;bottom:0;left:0;right:0;background:#babaaa;border-top:1px solid #777;padding:5px 12px;font-size:11px}.hint,.smallprint{font-size:11px;color:#3d3d3d}.red{background:#e3cccc}.amber{background:#e5dcc4}h2{font-size:15px;margin-top:18px}a{color:#003d7a}`;
}

async function readForm(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const state = readState(req);

  if (req.method === "GET" && url.pathname === "/") return send(res, 200, shell());
  if (req.method === "GET" && url.pathname === "/legacy-banner") return send(res, 200, banner());
  if (req.method === "GET" && url.pathname === "/assets/legacy.css") {
    res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" });
    return res.end(assetCss());
  }
  if (req.method === "GET" && url.pathname === "/app/home") return send(res, 200, homePage(state));
  if (req.method === "GET" && url.pathname === "/app/member-search") return send(res, 200, memberSearchPage());
  if (req.method === "GET" && url.pathname === "/app/help") return send(res, 200, helpPage());

  if (req.method === "POST" && url.pathname === "/app/member-search") {
    const form = await readForm(req);
    const memberId = (form.get("mbr_no_x7") || "").trim().toUpperCase();
    if (!memberId) return send(res, 422, memberSearchPage(`<div class="error"><b>VALIDATION V10</b><br>Member number is required.</div>`));
    return redirect(res, `/app/member/${encodeURIComponent(memberId)}`);
  }

  const memberMatch = url.pathname.match(/^\/app\/member\/([^/]+)$/);
  if (req.method === "GET" && memberMatch) {
    const memberId = decodeURIComponent(memberMatch[1]).toUpperCase();
    if (memberId === "200017") {
      const failure = hardFailurePage("Access Denied", "SECURITY S17", "Your operator profile cannot view this restricted relationship.");
      return send(res, failure.status, failure.body);
    }
    if (memberId === "EXPIRED") {
      const failure = hardFailurePage("Session Expired", "SESSION E01", "The CoreBank session is no longer valid. Sign-in by a human operator is required.", 401);
      return send(res, failure.status, failure.body);
    }
    if (memberId === "APP-500") {
      const failure = hardFailurePage("Core Host Error", "HOST X500", "The core host returned an unexpected processing error.", 500);
      return send(res, failure.status, failure.body);
    }
    if (memberId === "100099" && !state.transientPassed && url.searchParams.get("retry") !== "1") {
      return send(res, 503, transientPage(memberId));
    }
    if (memberId === "100099" && url.searchParams.get("retry") === "1") state.transientPassed = true;
    const member = members[memberId];
    if (!member) return send(res, 200, memberSearchPage(`<div class="notice"><b>BUSINESS RESULT N04</b><br>No member relationship matched ${escapeHtml(memberId)}. No system error occurred.</div>`));
    state.memberId = memberId;
    return send(res, 200, memberPage(member), { "Set-Cookie": stateCookie(state) });
  }

  if (req.method === "GET" && url.pathname === "/app/account") {
    const accountNumber = url.searchParams.get("acct");
    const found = Object.values(members).flatMap((member) => member.accounts.map((account) => ({ member, account }))).find(({ account }) => account.number === accountNumber);
    if (!found) return send(res, 404, page("Account Not Found", `<div class="notice"><b>BUSINESS RESULT N12</b><br>The requested account does not exist.</div>`));
    return send(res, 200, accountPage(found.member, found.account));
  }

  if (req.method === "POST" && url.pathname === "/app/subaccount/start") {
    const form = await readForm(req);
    const memberId = form.get("member_ref");
    if (!members[memberId]) return send(res, 400, page("Invalid Workflow", `<div class="error">Member context is missing.</div>`));
    state.memberId = memberId;
    delete state.draft;
    delete state.supervisorAcknowledged;
    return redirect(res, `/app/subaccount/new?member=${memberId}`, state);
  }

  if (req.method === "GET" && url.pathname === "/app/subaccount/new") {
    const memberId = url.searchParams.get("member") || state.memberId;
    const member = members[memberId];
    if (!member) return send(res, 400, page("Invalid Workflow", `<div class="error">Select a member before opening a sub-account.</div>`));
    const values = state.draft ? { prod_x12: state.draft.product, memo_line_3: state.draft.nickname, amt_1a: state.draft.amount, stmt_opt: state.draft.statement } : {};
    return send(res, 200, subaccountForm(member, values));
  }

  if (req.method === "POST" && url.pathname === "/app/subaccount/review") {
    const form = await readForm(req);
    const memberId = form.get("member_ref");
    const member = members[memberId];
    const product = form.get("prod_x12");
    const amountRaw = (form.get("amt_1a") || "").trim();
    const amount = Number(amountRaw.replaceAll(",", ""));
    const values = { prod_x12: product, memo_line_3: form.get("memo_line_3") || "", amt_1a: amountRaw, stmt_opt: form.get("stmt_opt") || "E" };
    let error = "";
    if (!member) error = "Member context is invalid. Return to member lookup.";
    else if (!PRODUCTS.has(product)) error = "Choose a product code.";
    else if (!Number.isFinite(amount) || amount < 0) error = "Opening deposit must be a non-negative number.";
    else if (amount > 25000) error = "Opening deposit exceeds the training transaction limit of CAD 25,000.00.";
    if (error) return send(res, 422, subaccountForm(member || members["100042"], values, error));
    state.memberId = memberId;
    state.draft = { memberId, product, nickname: values.memo_line_3.trim(), amount, statement: values.stmt_opt };
    state.humanReviewRequired = Boolean(member.reviewRequired || amount >= 5000);
    state.reviewReason = member.reviewRequired ? "member relationship flag R17" : amount >= 5000 ? "opening deposit is CAD 5,000.00 or more" : "";
    state.supervisorAcknowledged = false;
    return redirect(res, "/app/subaccount/review", state);
  }

  if (req.method === "GET" && url.pathname === "/app/subaccount/review") {
    const member = state.draft && members[state.draft.memberId];
    if (!member) return send(res, 409, page("No Pending Request", `<div class="notice">There is no prepared sub-account request in this browser session.</div><p><a href="/app/member-search">Start member lookup</a></p>`));
    return send(res, 200, reviewPage(state, member));
  }

  if (req.method === "POST" && url.pathname === "/app/subaccount/supervisor") {
    if (!state.draft || !state.humanReviewRequired) return send(res, 409, page("No Review Hold", `<div class="error">No request is waiting for supervisor review.</div>`));
    state.supervisorAcknowledged = true;
    return redirect(res, "/app/subaccount/review", state);
  }

  if (req.method === "POST" && url.pathname === "/app/subaccount/simulate") {
    if (!state.draft) return send(res, 409, page("No Pending Request", `<div class="error">Nothing is available to simulate.</div>`));
    if (state.humanReviewRequired && !state.supervisorAcknowledged) return send(res, 409, page("Supervisor Required", `<div class="warning">An authorized supervisor must review this request before simulation.</div>`));
    state.lastTrainingReference = `TRAIN-${state.draft.memberId}-${String(Math.round(state.draft.amount * 100)).padStart(6, "0")}`;
    delete state.draft;
    delete state.humanReviewRequired;
    delete state.reviewReason;
    delete state.supervisorAcknowledged;
    return send(res, 200, receiptPage(state), { "Set-Cookie": stateCookie(state) });
  }

  if (req.method === "POST" && url.pathname === "/app/reset") {
    res.writeHead(303, { Location: "/app/home", "Set-Cookie": clearStateCookie() });
    return res.end();
  }

  return send(res, 404, page("Unknown Function", `<div class="error"><b>ROUTE 404</b><br>This CoreBank function code does not exist.</div><p><a href="/app/home">Return to operations menu</a></p>`));
}

module.exports = { handleRequest, members, readState, stateCookie };
