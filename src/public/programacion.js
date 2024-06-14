// Función para cargar las opciones de base desde el servidor
function cargarBases() {
    fetch('/api/bases') // Endpoint para obtener las bases desde el servidor
        .then(response => response.json())
        .then(data => {
            const baseSelect = document.getElementById('base');
            baseSelect.innerHTML = ''; // Limpiar las opciones actuales

            data.forEach(base => {
                const option = document.createElement('option');
                option.value = base;
                option.textContent = base;
                baseSelect.appendChild(option);
            });
            // Llamar a la función para cargar las placas cuando se selecciona una base
            baseSelect.addEventListener('change', cargarPlacas);
        })
        .catch(error => {
            console.error('Error al cargar las bases:', error);
        });
}

// Función para cargar las opciones de placa según la base seleccionada
function cargarPlacas() {
    const baseSeleccionada = document.getElementById('base').value;
    fetch(`/api/placas?base=${baseSeleccionada}`) // Endpoint para obtener las placas según la base seleccionada
        .then(response => response.json())
        .then(data => {
            const placasSelect = document.getElementById('placa');
            placasSelect.innerHTML = ''; // Limpiar las opciones actuales

            data.forEach(placa => {
                const option = document.createElement('option');
                option.value = placa;
                option.textContent = placa;
                placasSelect.appendChild(option);
            });
        })
        .catch(error => {
            console.error('Error al cargar las placas:', error);
        });
}

// Llamar a la función para cargar las bases cuando la página se cargue completamente
document.addEventListener('DOMContentLoaded', cargarBases);

const scriptURL = "https://script.google.com/macros/s/AKfycbziHx7tcGQOf59803938jQSub0mbSQECXOXALaZ9B6QlRbTle_Fg0fVFobQfZWEKN9ylw/exec";
const form = document.getElementById("programacionForm"); // Cambiado el ID del formulario
form.addEventListener("submit", e => {
    e.preventDefault(); // Prevenir la acción por defecto del formulario

    // Mostrar mensaje de carga
    const loadingMessage = document.createElement('p');
    loadingMessage.textContent = 'Enviando formulario...';
    form.appendChild(loadingMessage);

    fetch(scriptURL, { 
        method: "POST", 
        body: new FormData(form) // Enviar los datos del formulario
    })
    .then(response => {
        // Eliminar mensaje de carga
        form.removeChild(loadingMessage);

        if (response.ok) { // Verificar si la respuesta es exitosa
            alert("¡Felicidades! Tu carro ha sido programado.");
            window.location.reload(); // Recargar la página después de enviar los datos
        } else {
            throw new Error("Error al enviar el formulario."); // Lanzar un error si la respuesta no es exitosa
        }
    })
    .catch(error => {
        console.error("Error:", error);
        alert("Hubo un error al enviar el formulario. Por favor, inténtalo de nuevo más tarde.");
        // Eliminar mensaje de carga en caso de error
        form.removeChild(loadingMessage);
    });
});

