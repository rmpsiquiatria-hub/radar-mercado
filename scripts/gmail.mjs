// Minimal Gmail sender (SMTP over implicit TLS, port 465, app password), shared by the e-mails.
import tls from "node:tls";
import { randomBytes } from "node:crypto";

/* ---------- minimal SMTP client for Gmail (implicit TLS, port 465) ---------- */
export async function sendGmail({ user, pass, to, subject, html, text, from = "Radar do Mercado" }) {
  const b64 = s => Buffer.from(s, "utf8").toString("base64");
  const wrap = s => s.match(/.{1,76}/g).join("\r\n");
  const boundary = "radar-" + randomBytes(8).toString("hex");
  const message = [
    `From: =?UTF-8?B?${b64(from)}?= <${user}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${Date.now()}.${randomBytes(6).toString("hex")}@radar-mercado>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(text)),
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(html)),
    `--${boundary}--`, "",
  ].join("\r\n");

  const sock = tls.connect({ host: "smtp.gmail.com", port: 465, servername: "smtp.gmail.com" });
  sock.setEncoding("utf8");
  let buf = "", failed = null;
  const waiters = [];
  const flush = () => {
    while (waiters.length) {
      const m = buf.match(/^(?:\d{3}-[^\r\n]*\r\n)*(\d{3})(?: [^\r\n]*)?\r\n/);
      if (!m) return;
      buf = buf.slice(m[0].length);
      waiters.shift().resolve({ code: +m[1], text: m[0].trim() });
    }
  };
  sock.on("data", d => { buf += d; flush(); });
  sock.on("error", err => { failed = err; waiters.splice(0).forEach(w => w.reject(err)); });
  const reply = () => new Promise((resolve, reject) => { if (failed) return reject(failed); waiters.push({ resolve, reject }); flush(); });
  // `label` names the step in errors so credentials never end up in a log.
  const step = async (line, ok, label) => {
    if (line != null) sock.write(line + "\r\n");
    const r = await reply();
    if (!ok.includes(r.code)) throw new Error(`SMTP ${label} recusado: ${r.text.replace(/\s+/g, " ").slice(0, 200)}`);
  };
  await new Promise((res, rej) => { sock.once("secureConnect", res); sock.once("error", rej); });
  try {
    await step(null, [220], "conexão");
    await step("EHLO radar-mercado", [250], "EHLO");
    await step("AUTH LOGIN", [334], "AUTH");
    await step(b64(user), [334], "usuário");
    await step(b64(pass), [235], "senha de app");
    await step(`MAIL FROM:<${user}>`, [250], "remetente");
    await step(`RCPT TO:<${to}>`, [250, 251], "destinatário");
    await step("DATA", [354], "DATA");
    await step(message + "\r\n.", [250], "envio");
    await step("QUIT", [221], "QUIT").catch(() => {});
  } finally { sock.end(); }
}
