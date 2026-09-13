// telegram.js — Telegram Bot API (gratuita, sin costo por mensaje)
//
// IMPORTANTE: un bot de Telegram NO puede escribirle primero a nadie (es una
// restriccion de la plataforma, no algo que se pueda evitar). Por eso el
// flujo real es:
//   1. Al registrar la entrada, se genera un link (construirLink) tipo
//      https://t.me/tu_bot?start=CODIGO y se muestra como QR ("Recibir
//      ticket por Telegram") para que el cliente lo escanee/toque.
//   2. El cliente toca "Iniciar" en Telegram -> el bot recibe ese mensaje
//      con su chat_id (ver services/telegramPoller.js, que revisa mensajes
//      nuevos cada pocos segundos).
//   3. Recien ahi se le manda el ticket de verdad con enviarMensaje().
//
// Para activarlo: crear un bot con @BotFather en Telegram (gratis, ~2 min)
// y poner el token en TELEGRAM_BOT_TOKEN dentro de backend/.env. Sin token,
// todo queda en modo "stub" (solo se loguea en consola).

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

let usernameCache = null;

async function obtenerUsername() {
  if (usernameCache) return usernameCache;
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const data = await res.json();
    if (data.ok) usernameCache = data.result.username;
  } catch (err) {
    console.error("[Telegram] No se pudo consultar el bot (getMe):", err.message);
  }
  return usernameCache;
}

async function construirLink(codigo) {
  if (!BOT_TOKEN) {
    console.log(`[STUB Telegram] Link no generado (falta TELEGRAM_BOT_TOKEN). Codigo: ${codigo}`);
    return null;
  }
  const username = await obtenerUsername();
  if (!username) return null;
  return `https://t.me/${username}?start=${codigo}`;
}

async function enviarMensaje(chatId, texto) {
  if (!BOT_TOKEN) {
    console.log(`[STUB Telegram] -> chat ${chatId}: ${texto}`);
    return;
  }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: texto }),
  });
}

module.exports = { construirLink, enviarMensaje, tieneToken: () => !!BOT_TOKEN, BOT_TOKEN };
