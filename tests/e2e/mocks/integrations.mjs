/* Stand-ins for the two services a live site talks to: the Rocket.Chat
   incoming webhook and the SMTP host it mails through. Both capture what
   they receive as JSON lines so the specs can assert on real delivery
   instead of trusting a stub call count, and neither reaches the network. */

import net from "node:net";
import http from "node:http";
import fs from "node:fs";

const append = (file, obj) => fs.appendFileSync(file, JSON.stringify(obj) + "\n");

/* Rocket.Chat incoming webhook: records each posted message. */
export function startWebhookMock({ port, host = "127.0.0.1", logFile }) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        /* record the raw body; a malformed post is a test failure, not a crash */
      }
      append(logFile, { url: req.url, body: parsed ?? body });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"success":true}');
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

/* SMTP host: enough of ESMTP for nodemailer to authenticate and deliver.
   Writing "fail" into modeFile makes it reject every message, which is how
   the specs exercise a provider outage without touching a real one. */
export function startSmtpMock({ port, host = "127.0.0.1", logFile, modeFile }) {
  const failing = () => {
    try {
      return fs.readFileSync(modeFile, "utf8").trim() === "fail";
    } catch {
      return false;
    }
  };

  const server = net.createServer((sock) => {
    let buf = "";
    let inData = false;
    let message = "";
    let from = "";
    let rcpt = [];
    let expectAuthLine = false;

    const send = (line) => sock.write(line + "\r\n");
    send("220 mock ESMTP ready");

    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            append(logFile, { from, rcpt, raw: message });
            send("250 2.0.0 Ok: queued");
          } else {
            // Undo dot-stuffing (RFC 5321 4.5.2).
            message += (line.startsWith("..") ? line.slice(1) : line) + "\n";
          }
          continue;
        }

        if (expectAuthLine) {
          // Base64 username/password of AUTH LOGIN; accepted unconditionally.
          expectAuthLine = false;
          send("235 2.7.0 Authentication successful");
          continue;
        }

        const verb = line.split(" ")[0].toUpperCase();
        switch (verb) {
          case "EHLO":
          case "HELO":
            send("250-mock");
            send("250-AUTH PLAIN LOGIN");
            send("250-8BITMIME");
            send("250 SMTPUTF8");
            break;
          case "AUTH":
            if (/^AUTH\s+LOGIN\s*$/i.test(line)) {
              expectAuthLine = true;
              send("334 VXNlcm5hbWU6");
            } else {
              send("235 2.7.0 Authentication successful");
            }
            break;
          case "MAIL":
            if (failing()) {
              send("451 4.3.0 Mock provider is down");
              break;
            }
            from = line.slice(line.indexOf(":") + 1).trim();
            rcpt = [];
            send("250 2.1.0 Ok");
            break;
          case "RCPT":
            rcpt.push(line.slice(line.indexOf(":") + 1).trim());
            send("250 2.1.5 Ok");
            break;
          case "DATA":
            inData = true;
            message = "";
            send("354 End data with <CR><LF>.<CR><LF>");
            break;
          case "RSET":
            from = "";
            rcpt = [];
            send("250 2.0.0 Ok");
            break;
          case "QUIT":
            send("221 2.0.0 Bye");
            sock.end();
            break;
          default:
            send("250 2.0.0 Ok");
        }
      }
    });

    sock.on("error", () => sock.destroy());
  });

  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
