// server.js — punto de entrada del backend
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/auth", require("./routes/auth"));
app.use("/parqueaderos", require("./routes/parqueaderos"));
app.use("/operadores", require("./routes/operadores"));
app.use("/vehiculos", require("./routes/vehiculos"));
app.use("/registros", require("./routes/registros"));
app.use("/reportes", require("./routes/reportes"));
app.use("/panico", require("./routes/panico"));

app.get("/salud", (req, res) => res.json({ ok: true }));

// Manejo de errores centralizado. Las rutas que envuelven sus handlers con
// asyncHandler (ver utils/asyncHandler.js) terminan aqui en vez de tumbar
// el proceso completo. err.status permite a una ruta pedir un codigo
// especifico (ej. 400 por datos faltantes); si no se especifica, es 500.
app.use((err, req, res, next) => {
  if (!err.status) console.error(err); // solo lo inesperado (5xx) se loguea con stack completo
  res.status(err.status || 500).json({ error: err.status ? err.message : "Error interno del servidor" });
});

process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API corriendo en http://localhost:${PORT}`));

require("./services/telegramPoller").iniciarPoller();
