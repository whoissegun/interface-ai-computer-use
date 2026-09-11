const http = require("node:http");
const { handleRequest } = require("./src/app");

const port = Number.parseInt(process.env.PORT || "4173", 10);

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(port, "0.0.0.0", () => {
    console.log(`Northstar Legacy Operations is running at http://localhost:${port}`);
  });
}

module.exports = server;
