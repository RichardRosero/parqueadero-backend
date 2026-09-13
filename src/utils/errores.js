// errores.js — helper para lanzar errores con codigo HTTP explicito.
// Ver server.js: el middleware de errores usa err.status para decidir el
// codigo de respuesta (400 = dato invalido/faltante) en vez de 500.
function errorConEstado(status, mensaje) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

module.exports = { errorConEstado };
