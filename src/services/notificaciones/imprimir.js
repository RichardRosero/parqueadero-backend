// imprimir.js — Impresora termica Bluetooth/USB (seccion 7 del documento)
// La impresion real ocurre del lado del dispositivo movil (la app se
// conecta a la impresora por Bluetooth), no desde este backend. Esta
// funcion solo registra la intencion y deja el contenido listo para que
// el cliente movil lo envie a la libreria de impresion (ej. react-native-thermal-receipt-printer).

async function imprimir(contenido) {
  console.log(`[STUB Impresion] Ticket listo para imprimir:\n${contenido.mensaje}`);
  return { ok: true, stub: true };
}

module.exports = { imprimir };
