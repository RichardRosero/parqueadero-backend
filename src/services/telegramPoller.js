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

      // El codigo es el mismo en la entrada y en la salida de un mismo
      // registro (no cambia al cerrarlo), asi que se busca sin filtrar por
      // estado: si el cliente escanea el QR de "Recibir ticket" al entrar,
      // el registro todavia esta activo; si escanea el QR que se le muestra
      // al salir, ya esta cerrado y con hora_salida — eso decide que mensaje
      // mandarle. Se toma el mas reciente por si el codigo se repitiera.
      const registro = db.prepare("SELECT * FROM registros WHERE codigo = ? ORDER BY hora_entrada DESC LIMIT 1").get(codigo);
      if (!registro) {
        await enviarMensaje(chatId, "No encontramos un ticket con ese código. Consulta en el parqueadero.");
        continue;
      }

      const parqueadero = db.prepare("SELECT nombre FROM parqueaderos WHERE id = ?").get(registro.parqueadero_id);
      const nombreSede = parqueadero?.nombre || "Parqueadero";

      if (registro.estado === "activo") {
        const textoTicket = [
          `🎫 ${nombreSede}`,
          `Placa: ${registro.placa}`,
          `Código: ${registro.codigo}`,
          `Entrada: ${new Date(registro.hora_entrada).toLocaleString()}`,
          "",
          "Guarda este código, lo vas a necesitar para retirar tu vehículo.",
        ].join("\n");
        await enviarMensaje(chatId, textoTicket);
      } else if (registro.hora_salida) {
        const minutos = Math.round((new Date(registro.hora_salida) - new Date(registro.hora_entrada)) / 60000);
        const horas = Math.floor(minutos / 60);
        const mins = minutos % 60;
        const textoSalida = [
          `🚗 ${nombreSede} — Salida registrada`,
          `Placa: ${registro.placa}`,
          `Entrada: ${new Date(registro.hora_entrada).toLocaleString()}`,
          `Salida: ${new Date(registro.hora_salida).toLocaleString()}`,
          `Tiempo total: ${horas}h ${mins}min`,
          `Valor a pagar: $${registro.valor_parqueo}`,
        ].join("\n");
        await enviarMensaje(chatId, textoSalida);
      }
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
