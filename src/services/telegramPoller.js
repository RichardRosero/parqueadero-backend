// telegramPoller.js — revisa periodicamente si algun cliente inicio el bot
// de Telegram (ver notificaciones/telegram.js para el porque de este flujo).
//
// Se usa "polling" (el backend pregunta) en vez de un webhook (Telegram
// avisando solo) porque el backend hoy corre en una IP privada, sin URL
// publica en internet — un webhook necesita esa URL publica y no la
// tenemos todavia. Cuando el backend se despliegue en la nube, esto se
// puede cambiar a webhook para menos latencia, pero polling funciona bien
// para este tamaño de operacion.

const db = require("../db");
const { enviarMensaje, tieneToken, BOT_TOKEN } = require("./notificaciones/telegram");

let ultimoUpdateId = 0;

async function revisarMensajes() {
  if (!tieneToken()) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${ultimoUpdateId + 1}&timeout=0`);
    const data = await res.json();
    if (!data.ok) return;

    for (const update of data.result) {
      ultimoUpdateId = update.update_id;
      const mensaje = update.message;
      const texto = mensaje?.text;
      if (!texto || !texto.startsWith("/start")) continue;

      const codigo = texto.replace("/start", "").trim();
      const chatId = mensaje.chat.id;
      if (!codigo) continue;

      const registro = db.prepare("SELECT * FROM registros WHERE codigo = ? AND estado = 'activo'").get(codigo);
      if (!registro) {
        await enviarMensaje(chatId, "No encontramos un ticket activo con ese código. Consulta en el parqueadero.");
        continue;
      }

      const parqueadero = db.prepare("SELECT nombre FROM parqueaderos WHERE id = ?").get(registro.parqueadero_id);
      const textoTicket = [
        `🎫 ${parqueadero?.nombre || "Parqueadero"}`,
        `Placa: ${registro.placa}`,
        `Código: ${registro.codigo}`,
        `Entrada: ${new Date(registro.hora_entrada).toLocaleString()}`,
        "",
        "Guarda este código, lo vas a necesitar para retirar tu vehículo.",
      ].join("\n");
      await enviarMensaje(chatId, textoTicket);
    }
  } catch (err) {
    console.error("[Telegram] Error revisando mensajes:", err.message);
  }
}

function iniciarPoller() {
  if (!tieneToken()) {
    console.log("[Telegram] TELEGRAM_BOT_TOKEN no configurado: el poller no se inicia (modo stub).");
    return;
  }
  setInterval(revisarMensajes, 3000);
  console.log("[Telegram] Poller iniciado (revisa mensajes nuevos cada 3s).");
}

module.exports = { iniciarPoller };
