// whatsapp.js — WhatsApp Business Cloud API (Meta)
// TODO real: requiere WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID en .env
// (cuenta de WhatsApp Business API aprobada por Meta, con plantilla de
// "utilidad" aprobada para este tipo de mensaje transaccional).
// Doc oficial: https://developers.facebook.com/docs/whatsapp/cloud-api

async function enviar(destino, contenido) {
  if (!process.env.WHATSAPP_TOKEN) {
    console.log(`[STUB WhatsApp] -> ${destino}: ${contenido.mensaje}`);
    return { ok: true, stub: true };
  }

  // Ejemplo real (descomentar y ajustar el nombre de plantilla ya aprobada):
  //
  // const res = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
  //   method: "POST",
  //   headers: {
  //     Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     messaging_product: "whatsapp",
  //     to: destino,
  //     type: "template",
  //     template: { name: "codigo_salida_parqueadero", language: { code: "es" } },
  //   }),
  // });
  // return res.json();
}

module.exports = { enviar };
