# Northstar Legacy Operations

Northstar Legacy Operations is a deliberately awkward, fictional credit-union back-office application. It is the live UI target for the computer-use assignment; it is **not** the AI discovery or replay harness.

Every identity, account, balance, branch, and transaction in this app is fake. The final action only creates a deterministic training reference. It never opens an account or moves money.

## Run locally

Node.js 20 or newer is the only requirement. There are no runtime packages to install.

```bash
cd target-app
npm start
```

Open [http://localhost:4173](http://localhost:4173). To use another port:

```bash
PORT=5000 npm start
```

Run the focused HTTP/state tests with:

```bash
npm test
```

## Main flows

### Read a balance

1. Choose **MEMBER LOOKUP**.
2. Enter member `100042`.
3. Open account `S-0042-01`.
4. Read the available savings balance: `$2,381.37`.

### Prepare a new savings sub-account

1. Look up member `100042`.
2. Choose **F9 - Open New Share/Sub-account**.
3. Pick a savings product, enter a nickname and an opening deposit below `5000`, and continue.
4. Reach the final review checkpoint.
5. Optionally use **SIMULATE FINAL SUBMISSION**. A browser confirmation appears, then the app creates only a fake `TRAIN-...` reference.

The server keeps workflow state in an HTTP-only browser cookie. That makes a pause-and-human-takeover flow use the same browser session, and it also works across stateless Vercel function invocations. This is suitable only for fake demo data: the cookie is intentionally unsigned and is not a production security design.

## Deterministic scenarios

| Input or condition | Visible result | Suggested classification |
| --- | --- | --- |
| Member `100042` | Normal member, balances, and sub-account flow | Success |
| Unknown member, e.g. `999999` | `BUSINESS RESULT N04` member not found | Expected business outcome |
| Blank member number | `VALIDATION V10` | Expected business outcome |
| Invalid product, negative deposit, or deposit over `25000` | `VALIDATION V22` | Expected business outcome |
| Member `100099` | First load returns HTTP 503/interstitial; its Retry link then succeeds | Recoverable condition |
| Member `200017` | HTTP 403 `SECURITY S17` | Hard failure |
| Member `EXPIRED` | HTTP 401 `SESSION E01` | Hard failure / human sign-in |
| Member `APP-500` | HTTP 500 `HOST X500` | Hard failure |
| Member `300088` | New-product review pauses at `HOLD H91` | Human intervention |
| Opening deposit of `5000` or more | Review pauses at `HOLD H91` | Human intervention |

The **OPS HELP** screen lists these cases and provides a button to reset the current browser's demo state. The transient condition resets with that state.

## Why the interface is awkward

The root document uses a legacy HTML frameset. Navigation and work happen in separate frames. The work screens are server-rendered, use table-heavy layouts, sparse semantic structure, old function-key language, cryptic field names, redirects after form posts, interstitials, and a native confirmation dialog. There are intentionally no test IDs. The behavior is deterministic, so it remains fair to automate.

## Deploy to Vercel

The `target-app` directory is independently deployable.

1. Import the repository in Vercel.
2. Set **Root Directory** to `target-app`.
3. Leave the framework preset as **Other** and the build command empty.
4. Deploy. `vercel.json` routes all requests to the Node function in `api/index.js`.

For a CLI deployment, run `vercel` from this directory after authenticating. No environment variables or secrets are required. Do not use this demonstration app with real customer information.

## Boundaries

- This app deliberately does not contain an LLM, a discovery loop, a capability format, or a deterministic replay engine.
- Browser-cookie state survives normal navigation and stateless hosting, but it expires after four hours and resets if cookies are cleared.
- The frameset is intentionally old-fashioned and may produce browser deprecation warnings; that is part of the target surface.
