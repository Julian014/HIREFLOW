const express = require("express");
const session = require("express-session");
const mysql = require('mysql2/promise');
const { engine } = require("express-handlebars");
const multer = require('multer');
const fs = require('fs');

const path = require('path');
const app = express();
app.set("port", process.env.PORT || 3000);
// Configure view engine
app.set("views", __dirname + "/views");
app.engine(".hbs", engine({ extname: ".hbs" }));  // Configura Handlebars como motor de vistas
app.set("view engine", "hbs");

const Handlebars = require('handlebars');
// Registrar el helper 'not'
Handlebars.registerHelper('not', function (value) {
    return !value;
});
app.use(express.json());  // Middleware para parsear JSON en las solicitudes
app.use(express.urlencoded({ extended: true }));  // Middleware para parsear URL-encoded en las solicitudes
app.use(express.static(__dirname + '/public'));  // Middleware para servir archivos estáticos desde el directorio 'public'




// Crea un pool de conexiones
const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'recursos_humanos',
    waitForConnections: true,
    connectionLimit: 10, // Número máximo de conexiones en el pool
    queueLimit: 0 // Número máximo de solicitudes en cola (0 = ilimitado)
});

// Exporta el pool para usarlo en otros módulos
module.exports = pool;

// Middleware para pasar una conexión del pool a cada objeto de solicitud
app.use(async (req, res, next) => {
    try {
        req.db = await pool.getConnection();
        res.on('finish', () => {
            req.db.release();
        });
        next();
    } catch (err) {
        next(err);
    }
});







// Session middleware
app.use(session({
    secret: "secret",  // Clave secreta para firmar la cookie de sesión
    resave: true,  // Forzar a que la sesión se guarde de nuevo en el almacenamiento de sesiones
    saveUninitialized: true  // Forzar a que una sesión se guarde, aunque no haya datos para almacenar
}));






// Render login form
app.get("/login", (req, res) => {
    if (req.session.loggedin) {
        res.redirect("/");  // Redirigir a la página principal si ya está autenticado
    } else {
        res.render("login/index.hbs", { error: null });  // Renderizar el formulario de inicio de sesión con un mensaje de error nulo
    }
});





// Handle login authentication
app.post("/auth", async (req, res) => {
    const data = req.body;
    const connection = req.db;

    try {
        const [userData] = await connection.query("SELECT * FROM user WHERE email = ? AND password = ?", [data.email, data.password]);

        if (userData.length > 0) {
            const user = userData[0];
            req.session.loggedin = true;  // Establecer sesión como autenticada
            req.session.name = user.name;  // Guardar nombre de usuario en la sesión
            req.session.roles = typeof user.roles === 'string' ? user.roles.split(',') : [];  // Guardar roles del usuario en la sesión

            res.redirect("/");  // Redirigir a la página principal después del inicio de sesión exitoso
        } else {
            // Renderizar página de inicio de sesión con mensaje de error
            res.render("login/index.hbs", { error: "Usuario no encontrado o contraseña incorrecta" });
        }
    } catch (err) {
        console.error("Error fetching user from database:", err);  // Manejar errores al recuperar datos del usuario desde la base de datos
        res.status(500).send("Internal Server Error");  // Enviar respuesta de error interno del servidor
    }
});


// Render register form
app.get("/register", (req, res) => {
    if (req.session.loggedin) {
        res.redirect("/");  // Redirigir a la página principal si ya está autenticado
    } else {
        res.render("login/register.hbs", { error: null });  // Renderizar el formulario de registro con mensaje de error nulo
    }
});




// Handle user registration
app.post("/storeUser", async (req, res) => {
    const data = req.body;
    const connection = req.db;

    try {
        const [userData] = await connection.query("SELECT * FROM user WHERE email = ?", [data.email]);

        if (userData.length > 0) {
            res.render("login/register.hbs", { error: "User with this email already exists" });  // Renderizar página de registro con mensaje de usuario ya existente
            return;
        }

        await connection.query("INSERT INTO user SET ?", data);
        console.log("User registered successfully");  // Registrar registro exitoso del usuario
        res.redirect("/");  // Redirigir a la página principal después del registro exitoso
    } catch (err) {
        console.error("Error handling user registration:", err);  // Manejar errores durante el registro del usuario
        res.status(500).send("Internal Server Error");  // Enviar respuesta de error interno del servidor
    }
});





// Handle logout
app.get("/logout", (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Error destroying session:", err);  // Manejar errores al destruir la sesión
            res.status(500).send("Internal Server Error");  // Enviar respuesta de error interno del servidor
        } else {
            res.redirect("/login");  // Redirigir a la página de inicio de sesión después de cerrar sesión
        }
    });
});

// Middleware to protect routes that require authentication
function requireLogin(req, res, next) {
    if (req.session.loggedin) {
        next();  // Pasar al siguiente middleware si está autenticado
    } else {
        res.redirect("/login");  // Redirigir a la página de inicio de sesión si no está autenticado
    }
}



const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid'); // Utiliza UUID para generar IDs únicos

// Configurar el transporter con nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'nexus.innovationss@gmail.com', // Coloca tu correo electrónico
        pass: 'dhmtnkcehxzfwzbd' // Coloca tu contraseña de correo electrónico
    },
    messageId: uuidv4(), // Genera un Message-ID único para cada correo enviado
});

const crypto = require('crypto'); // Importa el módulo crypto

// Handle forgot password
app.post("/forgot-password", async (req, res) => {
    const { email } = req.body;
    const connection = req.db;

    // Generar un token único y establecer la fecha de expiración
    const resetToken = crypto.randomBytes(20).toString('hex');
    const resetTokenExpiration = new Date();
    resetTokenExpiration.setHours(resetTokenExpiration.getHours() + 1); // Token válido por 1 hora

    try {
        const [result] = await connection.query(
            "UPDATE user SET resetToken = ?, resetTokenExpiration = ? WHERE email = ?",
            [resetToken, resetTokenExpiration, email]
        );

        // Check if user with provided email exists
        if (result.affectedRows === 0) {
            res.render("login/index.hbs", { error: "Correo electrónico no encontrado" });
        } else {
            const mailOptions = {
                from: 'nexus.innovationss@gmail.com',
                to: email,
                subject: 'Recuperación de Contraseña',
                html: `
                    <p>Hola,</p>
                    <p>Haz clic en el siguiente enlace para restablecer tu contraseña:</p>
                    <a href="http://localhost:3000/reset-password?token=${resetToken}">Restablecer Contraseña</a>
                    <p>Este enlace expirará en 1 hora.</p>
                    <p>Si no solicitaste esto, por favor ignora este correo y tu contraseña permanecerá sin cambios.</p>
                `
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error("Error sending email:", error);
                    res.status(500).send("Error al enviar el correo electrónico");
                } else {
                    console.log("Email sent:", info.response);
                    res.render("login/index.hbs", { successMessage: "Se ha enviado un correo electrónico con instrucciones para restablecer la contraseña" });
                }
            });
        }
    } catch (err) {
        console.error("Error updating reset token in database:", err);
        res.status(500).send("Internal Server Error");
    }
});



// Página para restablecer la contraseña (GET)
app.get("/reset-password", async (req, res) => {
    const token = req.query.token; // Obtiene el token de la consulta
    console.log("Token recibido en GET:", token);

    try {
        const connection = req.db;

        // Verificar si el token es válido y está dentro del tiempo de expiración adecuado
        const [results] = await connection.query(
            "SELECT * FROM user WHERE resetToken = ? AND resetTokenExpiration > NOW()",
            [token]
        );

        if (results.length === 0) {
            res.status(400).send("El token para restablecer la contraseña es inválido o ha expirado");
        } else {
            // Mostrar el formulario para restablecer la contraseña
            res.render("login/reset-password.hbs", { token });
        }
    } catch (err) {
        console.error("Error al verificar el token:", err);
        res.status(500).send("Error interno al verificar el token");
    }
});







// Procesar restablecimiento de contraseña (POST)
app.post("/reset-password", async (req, res) => {
    const { token, password } = req.body;

    try {
        const connection = req.db;

        // Verificar si el token es válido y está dentro del tiempo de expiración adecuado
        const [results] = await connection.query(
            "SELECT * FROM user WHERE resetToken = ? AND resetTokenExpiration > NOW()",
            [token]
        );

        if (results.length === 0) {
            res.status(400).send("El token para restablecer la contraseña es inválido o ha expirado");
        } else {
            const user = results[0];

            // Actualizar la contraseña en la base de datos y limpiar el token
            await connection.query(
                "UPDATE user SET password = ?, resetToken = NULL, resetTokenExpiration = NULL WHERE id = ?",
                [password, user.id]
            );

            console.log("Contraseña actualizada exitosamente para el usuario:", user.email);

            // Redirigir al usuario a la página de inicio de sesión con un mensaje de éxito
            res.render("login/index.hbs", { successMessage: "Contraseña restablecida exitosamente" });
        }
    } catch (err) {
        console.error("Error al procesar el restablecimiento de la contraseña:", err);
        res.status(500).send("Error interno al procesar el restablecimiento de la contraseña");
    }
});








// Ruta para la página principal 
app.get("/", (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        console.log(`El usuario ${nombreUsuario} está autenticado.`);
        req.session.nombreGuardado = nombreUsuario; // Guarda el nombre en la sesión

        const rolesString = req.session.roles;
        const roles = Array.isArray(rolesString) ? rolesString : [];



        const administrativo = roles.includes('administrativo');
        const empleado = roles.includes('empleado');
 

        res.render("EMPRESA/home.hbs",{ name: req.session.name,administrativo,empleado }); // Pasar los roles a la plantilla
    } else {
        res.redirect("/login");
    }
});



//ruta para ingresar nuevos usuarios

app.get('/nuevoUsuario', (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        res.render('nuevosUsuarios/ingresarNuevo_usuario.hbs', { nombreUsuario });
    } else {
        // Manejo para el caso en que el usuario no está autenticado
        res.redirect("/login");
    }
});

// Ruta para guardar un nuevo empleado
app.post('/guardarEmpleado', async (req, res) => {
    const { nombre, apellido, tipo, email, documento, sexo, telefono, direccion, fechaNacimiento, rol } = req.body;
    const connection = req.db;

    try {
        // Verificar si el email ya está registrado
        const sqlCheckEmail = 'SELECT COUNT(*) AS count FROM empleados WHERE email = ?';
        const [results] = await connection.query(sqlCheckEmail, [email]);

        const count = results[0].count;
        if (count > 0) {
            // El correo electrónico ya está registrado
            return res.status(400).render('nuevosUsuarios/ingresarNuevo_usuario.hbs', {
                error: 'El correo electrónico ya está registrado. Intente con otro correo.'
            });
        }

        // Si el correo no está registrado, proceder con la inserción
        const clave = generarClaveAleatoria(8); // Generar clave aleatoria
        const nuevoEmpleado = {
            nombre,
            apellido,
            email,
            tipo,
            documento,
            sexo,
            telefono,
            direccion,
            fechaNacimiento,
            rol
        };

        const sqlEmpleado = 'INSERT INTO empleados SET ?';
        const sqlUser = 'INSERT INTO user (name, email, password) VALUES (?, ?, ?)';

        await connection.beginTransaction();

        // Insertar en la tabla empleados
        const [resultEmpleado] = await connection.query(sqlEmpleado, nuevoEmpleado);
        console.log('Nuevo empleado creado en la tabla "empleados":', resultEmpleado.insertId);

        // Insertar en la tabla users
        const [resultUser] = await connection.query(sqlUser, [nombre, email, clave]);
        console.log('Nuevo usuario creado en la tabla "users":', resultUser.insertId);

        // Commit la transacción si todo fue exitoso
        await connection.commit();
        console.log('Transacción completada, empleado y usuario creados correctamente.');

        // Envío de correo electrónico al empleado con la clave
        enviarCorreo(email, nombre, clave);

        // Redirigir al usuario a la página de nuevo usuario
        res.redirect('/nuevoUsuario');
    } catch (err) {
        console.error('Error al guardar el empleado:', err);
        await connection.rollback();
        res.status(500).send('Error interno al guardar el empleado');
    }
});



// Función para generar clave aleatoria
function generarClaveAleatoria(length) {
    return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}


// Función para enviar correo electrónico
function enviarCorreo(email, nombre, clave) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'nexus.innovationss@gmail.com', // Coloca tu correo electrónico
            pass: 'dhmtnkcehxzfwzbd' // Coloca tu contraseña de correo electrónico
        },
    });

    const mailOptions = {
        from: 'nexus.innovationss@gmail.com', // Dirección del remitente
        to: email, // Dirección del destinatario
        subject: 'Bienvenido a nuestra Compañía', // Asunto del correo
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
                    <img src="https://example.com/logo.png" alt="Logo de la empresa" style="max-width: 100px; height: auto;">
                </div>
                <div style="background-color: #ffffff; padding: 30px;">
                    <h2 style="color: #333333; text-align: center;">¡Bienvenido a nuestra Compañía!</h2>
                    <p style="font-size: 16px; line-height: 1.6; text-align: justify;">
                        Hola <strong>${nombre}</strong>,
                    </p>
                    <p style="font-size: 16px; line-height: 1.6; text-align: justify;">
                        Estás a punto de continuar con el proceso. Este mensaje es enviado para que accedas a nuestra plataforma y subas la documentación solicitada en el <strong>módulo de MENÚ DE EMPLEADOS</strong>.
                    </p>
                    <p style="font-size: 16px; line-height: 1.6; text-align: center;">
                        <strong>Enlace de la plataforma:</strong> <a href="http://localhost:3000/login" style="color: #333333; text-decoration: none;">http://localhost:3000/login</a>
                    </p>
                    <p style="font-size: 16px; line-height: 1.6;">
                        Tus credenciales para ingresar son:
                    </p>
                    <p style="font-size: 16px; line-height: 1.6; margin-bottom: 10px;">
                        Correo: <strong>${email}</strong>
                    </p>
                    <p style="font-size: 16px; line-height: 1.6; margin-bottom: 10px;">
                        Contraseña: <strong>${clave}</strong>
                    </p>
                    <p style="font-size: 16px; line-height: 1.6; text-align: justify;">
                        Por favor, asegúrate de completar este paso lo antes posible.
                    </p>
                </div>
                <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
                    <p style="font-size: 14px; color: #666666;">Este es un mensaje automático. Por favor, no respondas a este correo.</p>
                </div>
            </div>
        `
    };
    

    transporter.sendMail(mailOptions, function(error, info){
        if (error) {
            console.error('Error al enviar el correo:', error);
        } else {
            console.log('Correo enviado: ' + info.response);
        }
    });
}












// Ruta para la página principal 
app.get("/menuempresa", (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        console.log(`El usuario ${nombreUsuario} está autenticado.`);
        req.session.nombreGuardado = nombreUsuario; // Guarda el nombre en la sesión

        const rolesString = req.session.roles;
        const roles = Array.isArray(rolesString) ? rolesString : [];



        const administrativo = roles.includes('administrativo');
        const empleado = roles.includes('empleado');
 

        res.render("EMPRESA/menuempresa.hbs",{ name: req.session.name,administrativo,empleado }); // Pasar los roles a la plantilla
    } else {
        res.redirect("/login");
    }
});















// Ruta para la página principal 
app.get("/menuempleados", (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        console.log(`El usuario ${nombreUsuario} está autenticado.`);
        req.session.nombreGuardado = nombreUsuario; // Guarda el nombre en la sesión

        const rolesString = req.session.roles;
        const roles = Array.isArray(rolesString) ? rolesString : [];



        const administrativo = roles.includes('administrativo');
        const empleado = roles.includes('empleado');
 

        res.render("EMPLEADOS/menuempleados.hbs",{ name: req.session.name,administrativo,empleado }); // Pasar los roles a la plantilla
    } else {
        res.redirect("/login");
    }
});













const moment = require('moment'); // Importa moment.js si no lo has hecho aún





// Ruta para mostrar los datos del empleado y formulario para subir información adicional
app.get('/subirinformacion', async (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        const connection = req.db;

        // Consulta para obtener los datos del empleado
        const sql = `SELECT id, nombre, apellido, tipo, documento, sexo, email, 
                             telefono, direccion, fechaNacimiento, rol,
                             tipo_sangre, estado_civil, emergencia_nombre, emergencia_telefono, foto
                     FROM empleados 
                     WHERE nombre = ?`;

        try {
            const [resultados] = await connection.query(sql, [nombreUsuario]);

            if (resultados.length === 0) {
                return res.status(404).send('Empleado no encontrado');
            }

            // Formatear la fecha de nacimiento
            const empleado = resultados[0];
            empleado.fechaNacimiento = moment(empleado.fechaNacimiento).format('DD MMMM YYYY');

            // Pasar empleado a la plantilla
            res.render('EMPLEADOS/documentos/subirinformacion', { empleado });
        } catch (err) {
            console.error('Error al obtener datos del empleado:', err);
            return res.status(500).send('Error interno al procesar la solicitud');
        }
    } else {
        res.redirect("/login");
    }
});



// Ruta para obtener la imagen del empleado por ID
app.get('/imagen/:id', async (req, res) => {
    const empleadoId = req.params.id;
    const connection = req.db;

    const sql = 'SELECT foto FROM empleados WHERE id = ?';

    try {
        const [results] = await connection.query(sql, [empleadoId]);

        if (results.length > 0 && results[0].foto) {
            // Escribir la imagen como respuesta
            const image = results[0].foto;
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Content-Length': image.length
            });
            res.end(image); // Envía el BLOB como respuesta (en formato imagen)
        } else {
            return res.status(404).send('Imagen no encontrada');
        }
    } catch (err) {
        console.error('Error al obtener la imagen:', err);
        return res.status(500).send('Error interno al procesar la solicitud');
    }
});







// Configurar almacenamiento de multer para guardar fotos en memoria
const storageFotos = multer.memoryStorage();
const uploadFotos = multer({ storage: storageFotos });

// Configurar almacenamiento de multer para guardar documentos en el sistema de archivos
const storageDocumentos = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public/uploads')); 
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const uploadDocumentos = multer({ storage: storageDocumentos });




// Ruta para actualizar empleados con foto
app.post('/update', uploadFotos.single('foto'), async (req, res) => {
    const empleado = req.body;
    const foto = req.file; // Si no se sube ninguna foto, req.file será undefined
    const connection = req.db;

    let sql;
    let sqlParams;

    if (foto) {
        // Se subió una nueva foto, obtener los datos binarios
        sql = `UPDATE empleados SET 
                   direccion = ?, 
                   tipo_sangre = ?, 
                   estado_civil = ?, 
                   emergencia_nombre = ?, 
                   emergencia_telefono = ?, 
                   foto = ?
               WHERE id = ?`;
        sqlParams = [
            empleado.direccion,
            empleado.tipo_sangre,
            empleado.estado_civil,
            empleado.emergencia_nombre,
            empleado.emergencia_telefono,
            foto.buffer, // Foto como dato binario
            empleado.id
        ];
    } else {
        // No se subió ninguna nueva foto, actualizar sin el campo de foto
        sql = `UPDATE empleados SET 
                   direccion = ?, 
                   tipo_sangre = ?, 
                   estado_civil = ?, 
                   emergencia_nombre = ?, 
                   emergencia_telefono = ?
               WHERE id = ?`;
        sqlParams = [
            empleado.direccion,
            empleado.tipo_sangre,
            empleado.estado_civil,
            empleado.emergencia_nombre,
            empleado.emergencia_telefono,
            empleado.id
        ];
    }

    try {
        await connection.query(sql, sqlParams);
        res.redirect('/subirinformacion');
    } catch (err) {
        console.error('Error al actualizar datos del empleado:', err);
        res.status(500).send('Error interno al procesar la solicitud');
    }
});





// Ruta para obtener la imagen del empleado por ID
app.get('/imagen/:id', async (req, res) => {
    const empleadoId = req.params.id;
    const connection = req.db;

    const sql = 'SELECT foto FROM empleados WHERE id = ?';

    try {
        const [results] = await connection.query(sql, [empleadoId]);

        if (results.length > 0 && results[0].foto) {
            // Escribir la imagen como respuesta
            const image = results[0].foto;
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Content-Length': image.length
            });
            res.end(image); // Envía el BLOB como respuesta (en formato imagen)
        } else {
            return res.status(404).send('Imagen no encontrada');
        }
    } catch (err) {
        console.error('Error al obtener la imagen:', err);
        return res.status(500).send('Error interno al procesar la solicitud');
    }
});





// Ruta para mostrar los datos del empleado y formulario para subir información adicional
app.get('/mihojadevida', async (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        const connection = req.db;

        // Consulta para obtener los datos del empleado
        const sql = `SELECT id, nombre, apellido, tipo, documento, sexo, email, 
                             telefono, direccion, fechaNacimiento, rol,
                             tipo_sangre, estado_civil, emergencia_nombre, emergencia_telefono, foto
                     FROM empleados 
                     WHERE nombre = ?`;

        try {
            const [resultados] = await connection.query(sql, [nombreUsuario]);

            if (resultados.length === 0) {
                return res.status(404).send('Empleado no encontrado');
            }

            // Formatear la fecha de nacimiento
            const empleado = resultados[0];
            empleado.fechaNacimiento = moment(empleado.fechaNacimiento).format('DD MMMM YYYY');

            // Pasar empleado a la plantilla
            res.render('EMPLEADOS/mihojadevida.hbs', { empleado });
        } catch (err) {
            console.error('Error al obtener datos del empleado:', err);
            return res.status(500).send('Error interno al procesar la solicitud');
        }
    } else {
        res.redirect("/login");
    }
});







// Ruta para la página principal
app.get("/subirdocumentos", async (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        console.log(`El usuario ${nombreUsuario} está autenticado.`);
        req.session.nombreGuardado = nombreUsuario; // Guarda el nombre en la sesión

        const rolesString = req.session.roles;
        const roles = Array.isArray(rolesString) ? rolesString : [];

        const jefe = roles.includes('jefe');
        const empleado = roles.includes('empleado');

        const connection = req.db;
        const query = 'SELECT * FROM documentos WHERE usuario = ?';

        try {
            const [results] = await connection.query(query, [nombreUsuario]);
            const documentos = results.length ? results[0] : null;
            res.render("EMPLEADOS/documentos/subirdocumentos.hbs", { name: req.session.name, jefe, empleado, documentos });
        } catch (err) {
            console.error('Error al consultar la base de datos:', err);
            res.status(500).send('Error al cargar los documentos.');
        }
    } else {
        res.redirect("/login");
    }
});


const adjustPath = (path) => {
    if (!path) return null;
    return path.replace(/src[\\\/]public[\\\/]/, ''); // Elimina "src/public/" o "src\public\"
};
app.post("/subirdocumentos", uploadDocumentos.fields([
    { name: 'documentoCedula' }, 
    { name: 'documentoContratacion' }, 
    { name: 'documentoTitulo' }, 
    { name: 'documentoTituloBachiller' }, 
    { name: 'documentoCertificaciones' }, 
    { name: 'documentoRecomendaciones' }, 
    { name: 'documentoAntecedentes' }, 
    { name: 'documentoExamenMedico' }, 
    { name: 'documentoFoto' }, 
    { name: 'documentoComprobanteDomicilio' }, 
    { name: 'documentoCesantias' },
    { name: 'documentoHojaVida' },
    { name: 'documentoEPS' },
    { name: 'documentoLibretaMilitar' },
    { name: 'documentoContraloria' }
]), async (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        const connection = req.db;

        try {
            // Leer los archivos subidos desde el sistema de archivos y convertirlos a binario
            const documentos = {
                cedula_path: req.files.documentoCedula ? fs.readFileSync(req.files.documentoCedula[0].path) : null,
                contratacion_path: req.files.documentoContratacion ? fs.readFileSync(req.files.documentoContratacion[0].path) : null,
                titulo_path: req.files.documentoTitulo ? fs.readFileSync(req.files.documentoTitulo[0].path) : null,
                titulo_bachiller_path: req.files.documentoTituloBachiller ? fs.readFileSync(req.files.documentoTituloBachiller[0].path) : null,
                certificaciones_path: req.files.documentoCertificaciones ? fs.readFileSync(req.files.documentoCertificaciones[0].path) : null,
                recomendaciones_path: req.files.documentoRecomendaciones ? fs.readFileSync(req.files.documentoRecomendaciones[0].path) : null,
                antecedentes_path: req.files.documentoAntecedentes ? fs.readFileSync(req.files.documentoAntecedentes[0].path) : null,
                examen_medico_path: req.files.documentoExamenMedico ? fs.readFileSync(req.files.documentoExamenMedico[0].path) : null,
                foto_path: req.files.documentoFoto ? fs.readFileSync(req.files.documentoFoto[0].path) : null,
                comprobante_domicilio_path: req.files.documentoComprobanteDomicilio ? fs.readFileSync(req.files.documentoComprobanteDomicilio[0].path) : null,
                cesantias_path: req.files.documentoCesantias ? fs.readFileSync(req.files.documentoCesantias[0].path) : null,
                hoja_vida_path: req.files.documentoHojaVida ? fs.readFileSync(req.files.documentoHojaVida[0].path) : null,
                eps_path: req.files.documentoEPS ? fs.readFileSync(req.files.documentoEPS[0].path) : null,
                libreta_militar_path: req.files.documentoLibretaMilitar ? fs.readFileSync(req.files.documentoLibretaMilitar[0].path) : null,
                contraloria_path: req.files.documentoContraloria ? fs.readFileSync(req.files.documentoContraloria[0].path) : null
            };

            // Consultar si ya existen documentos subidos para el usuario
            const query = 'SELECT * FROM documentos WHERE usuario = ?';
            const [results] = await connection.query(query, [nombreUsuario]);

            if (results.length > 0) {
                // Actualizar documentos existentes en bloques
                for (const [key, value] of Object.entries(documentos)) {
                    if (value !== null) {
                        const updateQuery = `UPDATE documentos SET ${key} = ? WHERE usuario = ?`;
                        await connection.query(updateQuery, [value, nombreUsuario]);
                    }
                }
                res.send('Archivos actualizados exitosamente.');
            } else {
                // Insertar nuevos documentos
                const insertQuery = `
                    INSERT INTO documentos (
                        usuario, cedula_path, contratacion_path, titulo_path, titulo_bachiller_path, certificaciones_path, recomendaciones_path, antecedentes_path, 
                        examen_medico_path, foto_path, comprobante_domicilio_path, cesantias_path, hoja_vida_path, eps_path, libreta_militar_path, contraloria_path
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

                await connection.query(insertQuery, [
                    nombreUsuario,
                    documentos.cedula_path,
                    documentos.contratacion_path,
                    documentos.titulo_path,
                    documentos.titulo_bachiller_path,
                    documentos.certificaciones_path,
                    documentos.recomendaciones_path,
                    documentos.antecedentes_path,
                    documentos.examen_medico_path,
                    documentos.foto_path,
                    documentos.comprobante_domicilio_path,
                    documentos.cesantias_path,
                    documentos.hoja_vida_path,
                    documentos.eps_path,
                    documentos.libreta_militar_path,
                    documentos.contraloria_path
                ]);
                res.send('Archivos subidos exitosamente.');
            }
        } catch (err) {
            console.error('Error al manejar la subida de documentos:', err);
            res.status(500).send('Error interno al procesar la solicitud');
        }
    } else {
        res.redirect("/login");
    }
});



 
// Servir archivos estáticos desde la carpeta 'src/uploads'
app.get('/validacion', async (req, res) => {
    if (req.session.loggedin === true) {
        const connection = req.db;
        const query = `
            SELECT * FROM documentos
            WHERE 
                COALESCE(cedula_validado, FALSE) = FALSE OR
                COALESCE(contratacion_validado, FALSE) = FALSE OR
                COALESCE(titulo_validado, FALSE) = FALSE OR
                COALESCE(titulo_bachiller_validado, FALSE) = FALSE OR
                COALESCE(certificaciones_validado, FALSE) = FALSE OR
                COALESCE(recomendaciones_validado, FALSE) = FALSE OR
                COALESCE(antecedentes_validado, FALSE) = FALSE OR
                COALESCE(examen_medico_validado, FALSE) = FALSE OR
                COALESCE(foto_validado, FALSE) = FALSE OR
                COALESCE(comprobante_domicilio_validado, FALSE) = FALSE OR
                COALESCE(cesantias_validado, FALSE) = FALSE OR
                COALESCE(hoja_vida_validado, FALSE) = FALSE OR
                COALESCE(eps_validado, FALSE) = FALSE OR
                COALESCE(libreta_militar_validado, FALSE) = FALSE OR
                COALESCE(contraloria_validado, FALSE) = FALSE
        `;

        try {
            const [results] = await connection.query(query);
            res.render('EMPRESA/Documentos/Validar_documentos.hbs', { documentos: results });
        } catch (err) {
            console.error('Error al obtener los documentos no validados:', err);
            return res.status(500).send('Error al obtener los documentos no validados.');
        }
    } else {
        // Manejo para el caso en que el usuario no está autenticado
        res.redirect("/login");
    }
});



app.get('/documento/:usuario/:tipo', async (req, res) => {
    if (req.session.loggedin === true) {
        const { usuario, tipo } = req.params;
        const connection = req.db;

        try {
            // Consultar el documento específico de la base de datos
            const query = `SELECT ${tipo}_path AS documento FROM documentos WHERE usuario = ?`;
            const [results] = await connection.query(query, [usuario]);

            if (results.length > 0 && results[0].documento) {
                // Configurar el encabezado para que el navegador trate el contenido como un archivo
                res.setHeader('Content-Disposition', `inline; filename="${tipo}.pdf"`); // Cambia la extensión según el tipo de archivo
                res.setHeader('Content-Type', 'application/pdf'); // Cambia el tipo MIME según el tipo de archivo
                res.send(results[0].documento);
            } else {
                res.status(404).send('Documento no encontrado');
            }
        } catch (err) {
            console.error('Error al obtener el documento:', err);
            res.status(500).send('Error interno al obtener el documento.');
        }
    } else {
        res.redirect("/login");
    }
});




app.post('/validardocumentos', async (req, res) => {
    const data = req.body;
    const updates = [];
    const rejectedDocuments = [];

    // Mapeo de tipos de documentos a sus respectivas columnas y rutas de archivos
    const documentColumnMap = {
        cedula: { column: 'cedula_validado', pathColumn: 'cedula_path' },
        contratacion: { column: 'contratacion_validado', pathColumn: 'contratacion_path' },
        titulo: { column: 'titulo_validado', pathColumn: 'titulo_path' },
        titulo_bachiller: { column: 'titulo_bachiller_validado', pathColumn: 'titulo_bachiller_path' },
        certificaciones: { column: 'certificaciones_validado', pathColumn: 'certificaciones_path' },
        recomendaciones: { column: 'recomendaciones_validado', pathColumn: 'recomendaciones_path' },
        antecedentes: { column: 'antecedentes_validado', pathColumn: 'antecedentes_path' },
        examen_medico: { column: 'examen_medico_validado', pathColumn: 'examen_medico_path' },
        foto: { column: 'foto_validado', pathColumn: 'foto_path' },
        comprobante_domicilio: { column: 'comprobante_domicilio_validado', pathColumn: 'comprobante_domicilio_path' },
        cesantias: { column: 'cesantias_validado', pathColumn: 'cesantias_path' },
        hoja_vida: { column: 'hoja_vida_validado', pathColumn: 'hoja_vida_path' },
        eps: { column: 'eps_validado', pathColumn: 'eps_path' },
        libreta_militar: { column: 'libreta_militar_validado', pathColumn: 'libreta_militar_path' },
        contraloria: { column: 'contraloria_validado', pathColumn: 'contraloria_path' }
    };

    for (const [key, value] of Object.entries(data)) {
        const [usuario, ...documentoParts] = key.split('_');
        const documento = documentoParts.join('_');
        const docInfo = documentColumnMap[documento];

        if (docInfo) {
            const validado = value === 'si' ? 1 : 0;
            updates.push({ validado, usuario, column: docInfo.column });

            if (validado === 0) {
                const razon = data[`${usuario}_${documento}_razon`] || 'No especificada';
                rejectedDocuments.push({ usuario, documento, razon, pathColumn: docInfo.pathColumn });
            }
        }
    }

    try {
        // Actualizar la base de datos
        for (const update of updates) {
            const sql = `UPDATE documentos SET ${update.column} = ? WHERE usuario = ?`;
            await req.db.query(sql, [update.validado, update.usuario]);
        }

        // Manejar documentos rechazados
        for (const rejection of rejectedDocuments) {
            // Obtener la ruta del archivo del documento
            const [docRows] = await req.db.query(`SELECT ?? FROM documentos WHERE usuario = ?`, [rejection.pathColumn, rejection.usuario]);
            const documentPath = docRows.length ? docRows[0][rejection.pathColumn] : null;

            // Obtener el email del empleado usando el nombre del usuario
            const [empRows] = await req.db.query('SELECT email FROM empleados WHERE nombre = ?', [rejection.usuario]);
            const email = empRows.length ? empRows[0].email : null;

            if (documentPath) {
                // Eliminar el archivo del documento
                const fullPath = path.join(__dirname, documentPath);
                fs.unlink(fullPath, (err) => {
                    if (err) console.error(`Error al eliminar el archivo: ${err}`);
                });

                // Limpiar la ruta en la base de datos
                const updatePathSQL = `UPDATE documentos SET ${rejection.pathColumn} = NULL WHERE usuario = ?`;
                await req.db.query(updatePathSQL, [rejection.usuario]);
            }

            if (email) {
                await enviarCorreoRechazo(email, rejection.documento, rejection.razon);
            }
        }

        res.redirect('/validacion');
    } catch (error) {
        console.error('Error al guardar las validaciones:', error);
        res.status(500).send('Ocurrió un error al guardar las validaciones');
    }
});

async function enviarCorreoRechazo(email, documento, razon) {
    const transporter = nodemailer.createTransport({
        service: 'Gmail',
        auth: {
            user: 'nexus.innovationss@gmail.com',
            pass: 'dhmtnkcehxzfwzbd'
        }
    });

    const mensaje = {
        from: 'nexus.innovationss@gmail.com',
        to: email,
        subject: 'Documento Rechazado',
        text: `El documento ${documento} no fue aceptado por la siguiente razón: ${razon}. Por favor, vuelve a subirlo.`
    };

    await transporter.sendMail(mensaje);
}







// Función para obtener usuarios con documentos validados
async function getUsuariosConDocumentosValidados() {
    const query = `
        SELECT usuario, cedula_validado, contratacion_validado, titulo_validado, titulo_bachiller_validado, 
               certificaciones_validado, recomendaciones_validado, antecedentes_validado, examen_medico_validado, 
               foto_validado, comprobante_domicilio_validado, cesantias_validado, hoja_vida_validado, 
               eps_validado, libreta_militar_validado, contraloria_validado
        FROM documentos
        WHERE 
            cedula_validado = '1' AND
            contratacion_validado = '1' AND
            titulo_validado = '1' AND
            titulo_bachiller_validado = '1' AND
            certificaciones_validado = '1' AND
            recomendaciones_validado = '1' AND
            antecedentes_validado = '1' AND
            examen_medico_validado = '1' AND
            foto_validado = '1' AND
            comprobante_domicilio_validado = '1' AND
            cesantias_validado = '1' AND
            hoja_vida_validado = '1' AND
            eps_validado = '1' AND
            libreta_militar_validado = '1' AND
            contraloria_validado = '1';
    `;
    
    const [rows] = await pool.query(query);
    return rows;
}

app.get('/enviar_contrato', async (req, res) => {
    if (req.session.loggedin === true) {
        try {
            const usuarios = await getUsuariosConDocumentosValidados();
            res.render('EMPRESA/contrato/enviar_contrato.hbs', { usuarios });
        } catch (error) {
            console.error(error);
            res.render('EMPRESA/usuarios_con_documentos_validados', { error: 'Error al obtener los usuarios.' });
        }
    } else {
        res.redirect("/login");
    }
});






app.get('/modificar_contrato/:usuario', async (req, res) => {
    const { usuario } = req.params;

    try {
        // Obtener detalles del empleado incluyendo tipo y documento
        const [empleadoResult] = await pool.query('SELECT nombre, apellido, tipo, documento FROM empleados WHERE nombre = ?', [usuario]);
        if (empleadoResult.length === 0) {
            return res.status(404).send('Empleado no encontrado');
        }
        const empleado = empleadoResult[0];

        res.render('EMPLEADOS/contrato/modificar_contrato', {
            usuario,
            empleado,
            tiposContrato: ['TERMINO INDEFINIDO', 'TERMINO FIJO', 'OBRA LABOR', 'PRESTACION DE SERVICIO']
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al obtener los detalles del empleado');
    }
});



const plantillasContratos = {
    "TERMINO INDEFINIDO": (empleado, datosContrato) => `
        <div class="page">
            <h1 style="text-align: center; font-size: 24px; font-weight: bold;">CONTRATO DE TRABAJO - TERMINO INDEFINIDO</h1>
            <p style="text-align: center; font-size: 16px;">Entre [Nombre de la Empresa] y ${empleado.nombre} ${empleado.apellido}</p>
            <p style="font-size: 14px; text-align: justify;">
                Tipo: ${empleado.tipo}<br>
                Documento: ${empleado.documento}<br>
                Este contrato de trabajo se celebra en <strong>${datosContrato.ciudad}</strong>, <strong>${datosContrato.pais}</strong>, el <strong>${datosContrato.fecha}</strong> entre:
            </p>
            <p style="font-size: 14px; text-align: justify;">
                Las partes acuerdan un contrato a término indefinido, el cual podrá ser terminado en cualquier momento con el debido preaviso.
            </p>
        </div>
    `,
    "TERMINO FIJO": (empleado, datosContrato) => `
        <div class="page">
            <h1 style="text-align: center; font-size: 24px; font-weight: bold;">CONTRATO DE TRABAJO - TERMINO FIJO</h1>
            <p style="text-align: center; font-size: 16px;">Entre [Nombre de la Empresa] y ${empleado.nombre} ${empleado.apellido}</p>
            <p style="font-size: 14px; text-align: justify;">
                Tipo: ${empleado.tipo}<br>
                Documento: ${empleado.documento}<br>
                Este contrato de trabajo se celebra en <strong>${datosContrato.ciudad}</strong>, <strong>${datosContrato.pais}</strong>, el <strong>${datosContrato.fecha}</strong> entre:
            </p>
            <p style="font-size: 14px; text-align: justify;">
                Las partes acuerdan un contrato a término fijo de ${datosContrato.duracion_contrato} meses, con posibilidad de renovación.
            </p>
        </div>
    `,
    "OBRA LABOR": (empleado, datosContrato) => `
        <div class="page">
            <h1 style="text-align: center; font-size: 24px; font-weight: bold;">CONTRATO DE TRABAJO - OBRA LABOR</h1>
            <p style="text-align: center; font-size: 16px;">Entre [Nombre de la Empresa] y ${empleado.nombre} ${empleado.apellido}</p>
            <p style="font-size: 14px; text-align: justify;">
                Tipo: ${empleado.tipo}<br>
                Documento: ${empleado.documento}<br>
                Este contrato de trabajo se celebra en <strong>${datosContrato.ciudad}</strong>, <strong>${datosContrato.pais}</strong>, el <strong>${datosContrato.fecha}</strong> entre:
            </p>
            <p style="font-size: 14px; text-align: justify;">
                Las partes acuerdan un contrato por obra o labor específica. El contrato terminará una vez se complete la labor para la cual fue contratado el empleado.
            </p>
        </div>
    `,
    "PRESTACION DE SERVICIO": (empleado, datosContrato) => `
        <div class="page">
            <h1 style="text-align: center; font-size: 24px; font-weight: bold;">CONTRATO DE PRESTACIÓN DE SERVICIOS</h1>
            <p style="text-align: center; font-size: 16px;">Entre [Nombre de la Empresa] y ${empleado.nombre} ${empleado.apellido}</p>
            <p style="font-size: 14px; text-align: justify;">
                Tipo: ${empleado.tipo}<br>
                Documento: ${empleado.documento}<br>
                Este contrato de prestación de servicios se celebra en <strong>${datosContrato.ciudad}</strong>, <strong>${datosContrato.pais}</strong>, el <strong>${datosContrato.fecha}</strong> entre:
            </p>
            <p style="font-size: 14px; text-align: justify;">
                El contratista se compromete a realizar los servicios descritos en este documento de acuerdo con las condiciones acordadas.
            </p>
        </div>
    `
};




app.post('/generar_contrato', async (req, res) => {
    const {
        usuario,
        tipo_contrato,
        tipo,
        documento,
        nombre,
        apellido,
        salario,
        duracion_contrato,
        ciudad = "Bogota D.C.",
        pais = "Colombia",
        fecha = new Date().toLocaleDateString('es-ES')
    } = req.body;

    try {
        // Obtener el email del usuario desde la tabla 'user'
        const [userResult] = await pool.query('SELECT email FROM user WHERE name = ?', [usuario]);
        if (userResult.length === 0) {
            return res.status(404).send('Usuario no encontrado');
        }
        const email = userResult[0].email;

        // Datos del empleado
        const empleado = { tipo, documento, nombre, apellido };

        // Datos adicionales del contrato
        const datosContrato = { salario, duracion_contrato, ciudad, pais, fecha };

        // Seleccionar la plantilla correcta según el tipo de contrato
        const contenido = plantillasContratos[tipo_contrato](empleado, datosContrato);

        // Guardar el contrato en la base de datos
        const query = `
            INSERT INTO contratos (usuario, contenido, tipo_contrato, salario, duracion_contrato) 
            VALUES (?, ?, ?, ?, ?)
        `;
        await pool.query(query, [usuario, contenido, tipo_contrato, salario, duracion_contrato]);

        // Enviar un correo electrónico al empleado
        const mailOptions = {
            from: 'nexus.innovationss@gmail.com',
            to: email,
            subject: 'Contrato de Trabajo Enviado',
            html: `
                <p>Hola <strong>${nombre}</strong>,</p>
                <p>Tu contrato de trabajo de tipo <strong>${tipo_contrato}</strong> ha sido enviado a través de nuestra plataforma.</p>
                <p>Por favor, <a href="http://tu-plataforma.com">ingresa a la plataforma</a> para revisar y firmar el contrato.</p>
                <p>Saludos,<br>[Nombre de la Empresa]</p>
            `,
        };

        await transporter.sendMail(mailOptions);

        res.send('Contrato generado y correo enviado correctamente');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al generar el contrato o enviar el correo');
    }
});






const bodyParser = require('body-parser');




// Increase the body-parser limit
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));




app.get('/ver_contrato', async (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        try {
            const [firmaResult] = await pool.query('SELECT firma_empleado FROM contratos WHERE usuario = ?', [nombreUsuario]);

            if (firmaResult.length > 0 && firmaResult[0].firma_empleado) {
                res.send(`
                    <script>
                        alert('Ya ha firmado el contrato');
                        window.location.href = '/menuempleados';
                    </script>
                `);
            } else {
                const [contratoResult] = await pool.query('SELECT contenido FROM contratos WHERE usuario = ?', [nombreUsuario]);
                if (contratoResult.length > 0) {
                    res.render('EMPLEADOS/contrato/ver_contrato', { contrato: contratoResult[0].contenido, usuario: nombreUsuario });
                } else {
                    res.status(404).send('Contrato no encontrado');
                }
            }
        } catch (error) {
            console.error(error);
            res.status(500).send('Error al cargar el contrato');
        }
    } else {
        res.redirect("/login");
    }
});

app.post('/guardar_firma', async (req, res) => {
    const { usuario, signature } = req.body;
    try {
        const query = `
            UPDATE contratos
            SET firma_empleado = ?, firmado = 1, fecha_firma = NOW()
            WHERE usuario = ?
        `;
        await pool.query(query, [signature, usuario]);
        res.send('Firma guardada correctamente');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al guardar la firma');
    }
});

app.get('/ver_contrato_firmado/:usuario', async (req, res) => {
    const { usuario } = req.params;
    try {
        const [result] = await pool.query('SELECT contenido, firma_empleado FROM contratos WHERE usuario = ?', [usuario]);
        if (result.length > 0) {
            const contrato = result[0].contenido.replace("[Firma del Empleado]", `<img src="${result[0].firma_empleado}" alt="Firma del Empleado" style="width: 150px; height: auto; display: block; margin: auto;">`);
            res.render('EMPLEADOS/contrato/ver_contrato', { contrato });
        } else {
            res.status(404).send('Contrato no encontrado');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al cargar el contrato');
    }
});


app.post('/guardar_contrato', async (req, res) => {
    const { usuario, contrato } = req.body;
    try {
        const query = `
            UPDATE contratos
            SET contenido = ?
            WHERE usuario = ?
        `;
        await pool.query(query, [contrato, usuario]);
        res.send('Contrato guardado correctamente');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al guardar el contrato');
    }
});



// Ruta para obtener el número total de empleados
app.get('/api/empleados', async (req, res) => {
    try {
        const [rows] = await req.db.query('SELECT COUNT(*) as count FROM empleados');
        res.json({ count: rows[0].count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Ruta para obtener el número de contratos
app.get('/api/contratos', async (req, res) => {
    try {
        const [rows] = await req.db.query('SELECT COUNT(*) as count FROM contratos');
        res.json({ count: rows[0].count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Ruta para obtener el número de empleados creados hoy
app.get('/api/empleados/hoy', async (req, res) => {
    try {
        const [rows] = await req.db.query('SELECT COUNT(*) as count FROM empleados WHERE fecha_creacion = CURRENT_DATE');
        res.json({ count: rows[0].count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


const exphbs = require('express-handlebars');

app.get('/vermidocumentacion', async (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        try {
            const [documentos] = await req.db.query('SELECT * FROM documentos WHERE usuario = ?', [nombreUsuario]);
            
            // Agregar campos para indicar el estado de verificación de los documentos
            const formattedDocumentos = documentos.map(doc => ({
                ...doc,
                cedula_validado: getVerificationStatus(doc.cedula_validado),
                contratacion_validado: getVerificationStatus(doc.contratacion_validado),
                titulo_validado: getVerificationStatus(doc.titulo_validado),
                titulo_bachiller_validado: getVerificationStatus(doc.titulo_bachiller_validado),
                certificaciones_validado: getVerificationStatus(doc.certificaciones_validado),
                recomendaciones_validado: getVerificationStatus(doc.recomendaciones_validado),
                antecedentes_validado: getVerificationStatus(doc.antecedentes_validado),
                examen_medico_validado: getVerificationStatus(doc.examen_medico_validado),
                foto_validado: getVerificationStatus(doc.foto_validado),
                comprobante_domicilio_validado: getVerificationStatus(doc.comprobante_domicilio_validado),
                cesantias_validado: getVerificationStatus(doc.cesantias_validado),
                hoja_vida_validado: getVerificationStatus(doc.hoja_vida_validado),
                eps_validado: getVerificationStatus(doc.eps_validado),
                libreta_militar_validado: getVerificationStatus(doc.libreta_militar_validado),
                contraloria_validado: getVerificationStatus(doc.contraloria_validado)
            }));

            res.render('EMPLEADOS/documentos/midocumentacion', { nombreUsuario, documentos: formattedDocumentos });
        } catch (err) {
            res.status(500).send('Error al obtener la documentación.');
        }
    } else {
        res.redirect("/login");
    }
});

function getVerificationStatus(status) {
    if (status === '1') return 'Verificado';
    if (status === '0') return 'Rechazado';
    return 'Pendiente';
}


app.get('/indicadores', async (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;

        // Obtener la fecha actual en formato 'YYYY-MM-DD'
        const today = new Date().toISOString().slice(0, 10);

        try {
            // Consulta para obtener la cantidad de empleados creados hoy
            const queryToday = 'SELECT COUNT(*) AS countToday FROM empleados WHERE DATE(fecha_creacion) = ?';
            const [rowsToday] = await pool.query(queryToday, [today]);

            const countToday = rowsToday[0].countToday;

            res.render('EMPRESA/indicadores.hbs', {
                nombreUsuario,
                countToday
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Error al obtener los indicadores.');
        }
    } else {
        res.redirect("/login");
    }
});

app.post('/indicadores/rango', async (req, res) => {
    if (req.session.loggedin === true) {
        const { startDate, endDate } = req.body;
        const nombreUsuario = req.session.name;

        try {
            // Consulta para obtener la cantidad de empleados creados en el rango de fechas
            const queryRange = 'SELECT COUNT(*) AS countRange FROM empleados WHERE DATE(fecha_creacion) BETWEEN ? AND ?';
            const [rowsRange] = await pool.query(queryRange, [startDate, endDate]);

            const countRange = rowsRange[0].countRange;

            res.render('EMPRESA/indicadores.hbs', {
                nombreUsuario,
                countRange,
                startDate,
                endDate
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Error al obtener los indicadores.');
        }
    } else {
        res.redirect("/login");
    }
});



app.get('/menudocumentos', (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        res.render('documentacion/homedocumentos.hbs', {navopertaivo: true,nombreUsuario });
    } else {
        res.redirect('/login');
    }
});

app.get('/seleccionarEmpleado', async (req, res) => {
    if (req.session.loggedin === true) {
        const connection = req.db;
        try {
            // Consulta para obtener la lista de nombres y números de documento
            const query = `
                SELECT DISTINCT e.nombre, e.documento
                FROM empleados e
                JOIN documentos d ON e.nombre = d.usuario
            `;
            
            const [empleados] = await connection.query(query);
            res.render('documentacion/descargar/seleccionarEmpleado.hbs', { empleados });
        } catch (err) {
            console.error('Error al obtener la lista de empleados:', err);
            res.status(500).send('Error interno al procesar la solicitud');
        }
    } else {
        res.redirect('/login');
    }
});



app.get('/descargardocumentos', (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.session.name;
        res.render('documentacion/descargar/descargar.hbs', {navopertaivo: true,nombreUsuario });
    } else {
        res.redirect('/login');
    }
});


app.post('/descargarDocumentos', async (req, res) => {
    if (req.session.loggedin === true) {
        const nombreUsuario = req.body.empleado;
        const connection = req.db;
        try {
            // Consulta para obtener los documentos del empleado seleccionado
            const [documentos] = await connection.query('SELECT * FROM documentos WHERE usuario = ?', [nombreUsuario]);
            if (documentos.length > 0) {
                res.render('documentacion/descargar/mostrarDocumentos.hbs', { documentos: documentos[0], nombreUsuario });
            } else {
                res.status(404).send('No se encontraron documentos para este empleado.');
            }
        } catch (err) {
            console.error('Error al obtener los documentos:', err);
            res.status(500).send('Error interno al procesar la solicitud');
        }
    } else {
        res.redirect('/login');
    }
});

app.get('/descargarDocumento/:usuario/:tipo', async (req, res) => {
    if (req.session.loggedin === true) {
        const usuario = req.params.usuario;
        const tipo = req.params.tipo;
        const connection = req.db;
        try {
            // Construir el nombre de la columna basado en el tipo de documento
            const column = tipo + '_path';
            const [documento] = await connection.query(`SELECT ${column} FROM documentos WHERE usuario = ?`, [usuario]);

            if (documento.length > 0 && documento[0][column]) {
                const buffer = documento[0][column];
                res.setHeader('Content-Disposition', `attachment; filename=${tipo}.pdf`);
                res.setHeader('Content-Type', 'application/pdf');
                res.send(buffer);
            } else {
                res.status(404).send('Documento no encontrado.');
            }
        } catch (err) {
            console.error('Error al descargar el documento:', err);
            res.status(500).send('Error interno al procesar la solicitud');
        }
    } else {
        res.redirect('/login');
    }
});




const archiver = require('archiver');


app.get('/descargarTodosDocumentos/:usuario', async (req, res) => {
    if (req.session.loggedin === true) {
        const usuario = req.params.usuario;
        const connection = req.db;

        try {
            const [documentos] = await connection.query('SELECT * FROM documentos WHERE usuario = ?', [usuario]);

            if (documentos.length > 0) {
                const documento = documentos[0];
                const dirPath = path.join(__dirname, 'public', 'tmp');

                // Crear el directorio si no existe
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                }

                const outputPath = path.join(dirPath, `${usuario}_documentos.zip`);
                const output = fs.createWriteStream(outputPath);
                const archive = archiver('zip', { zlib: { level: 9 } });

                // Manejar la salida del stream
                output.on('close', function () {
                    res.download(outputPath, `${usuario}_documentos.zip`, (err) => {
                        if (err) {
                            console.error('Error al descargar el archivo:', err);
                        }
                        // Eliminar el archivo zip temporal después de la descarga
                        fs.unlinkSync(outputPath);
                    });
                });

                // Iniciar el proceso de compresión
                archive.pipe(output);

                // Añadir cada documento al archivo zip
                for (const key in documento) {
                    if (documento[key] && key.endsWith('_path')) {
                        const buffer = documento[key];
                        const fileName = key.replace('_path', '') + '.pdf';
                        archive.append(buffer, { name: fileName });
                    }
                }

                await archive.finalize();
            } else {
                res.status(404).send('No se encontraron documentos para este usuario.');
            }
        } catch (err) {
            console.error('Error al crear el archivo zip:', err);
            res.status(500).send('Error interno al procesar la solicitud');
        }
    } else {
        res.redirect('/login');
    }
});



app.listen(app.get("port"), () => {
    console.log("Server listening on port ", app.get("port"));  // Iniciar el servidor y escuchar en el puerto especificado
});
