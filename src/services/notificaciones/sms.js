// sms.js — Proveedor de SMS (ejemplo: Twilio)
// TODO real: crear cuenta con tu proveedor de SMS preferido y completar
// SMS_PROVIDER_API_KEY / SMS_PROVIDER_FROM en .env

async function enviar(destino, contenido) {
  if (!process.env.SMS_PROVIDER_API_KEY) {
    console.log(`[STUB SMS] -> ${destino}: ${contenido.mensaje}`);
    return { ok: true, stub: true };
  }

  // Ejemplo real con Twilio (npm install twilio):
  //
  // const twilio = require("twilio")(process.env.SMS_PROVIDER_API_KEY, process.env.SMS_PROVIDER_SECRET);
  // return twilio.messages.create({ to: destino, from: process.env.SMS_PROVIDER_FROM, body: contenido.mensaje });
}

module.exports = { enviar };
