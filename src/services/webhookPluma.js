// webhookPluma.js — Integracion con sistemas externos (seccion 11)
// Al confirmar una salida valida, se hace POST a la URL que el admin
// configuro para su parqueadero, con un booleano claro.

async function abrirPluma(webhookUrl) {
  if (!webhookUrl) return { ok: false, motivo: "sin_webhook_configurado" };
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gate: true, timestamp: new Date().toISOString() }),
    });
    return { ok: res.ok };
  } catch (err) {
    console.error("Error llamando webhook de pluma:", err.message);
    return { ok: false, motivo: err.message };
  }
}

module.exports = { abrirPluma };
