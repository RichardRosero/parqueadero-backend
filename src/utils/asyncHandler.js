// asyncHandler.js
// Express 4 no captura automaticamente los rechazos de promesas lanzados
// por handlers `async`: si uno de esos handlers lanza una excepcion (por
// ejemplo, un dato requerido que llega undefined), la promesa rechazada
// queda sin manejar y tumba TODO el proceso de Node, dejando sin servicio
// a todos los negocios/sedes. Este wrapper reenvia cualquier error al
// middleware de errores centralizado de server.js en vez de dejar que
// explote el proceso.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
