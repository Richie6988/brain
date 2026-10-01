// Boutons du compte administrateur : « Console IA » (ancien Nod-Z Data) et « Utilisateurs » (ancien Nod-Z Users).
// Les consoles sont dans toolbox/static/gardien/admin.js ; elles s'ouvrent sur l'événement « nodz-admin ».
function administration() {
    [['statsButton', 'console', 'Console IA'], ['usersButton', 'users', 'Utilisateurs']].forEach(([id, panel, label]) => {
        const button = document.createElement('button');
        button.id = id;
        button.classList.add('menuBtn');
        button.onclick = () => document.dispatchEvent(new CustomEvent('nodz-admin', { detail: panel }));
        document.getElementById('button-container').appendChild(button);
        setTimeout(() => createTooltip(id, label), 100);
    });
}

// Univers d'un autre compte, en lecture (save() ne fait rien tant que admin est vrai).
function adminload(userID,layer){
    loadingSpinner.style.display = 'block';
    isLoading = true;
    selectedNodes.length = 0;
    currentNode = null;
    const csrfToken = getCookie('nodz_csrftoken');
    fetch('/admin-loading/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken,
        },
        body: JSON.stringify({userID: userID, layer: layer}), 
    }).then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();   
    }).then(data => {      
        admin = true;  // avant tout rendu : rien ne s'enregistre, même si l'affichage échoue plus loin
        rebootUniverse(); 
        if (data.layers) {
            layers.length = 0;
            let layerItems = Array.isArray(data.layers) ? data.layers : [data.layers]; // Wrap single object in an array
            layerItems .forEach(layer => {  
                layers.push({ id: layer.layerid, name: layer.layername });
            });  
        } if (data.params) {
            data.params.forEach(param => {    
                loadParams(param);
            });
        } if (data.user) {
            data.user.forEach(param => {   
                loadUser(param);
            });
        } if (data.nodes) {
            data.nodes.forEach(node => {    
                displayNode(node);
            });
        } if (data.links) {
            data.links.forEach(link => {    
                displayLink(link);               
            });
        } if (data.templates) {
            data.templates.forEach(template => {    
                displayTemplate(template);               
            });
        } if (data.notifications) {
            data.notifications.forEach(notification => {    
                const dateString = notification.notification; 
                // Convert to Date object
                const [day, month, yearAndTime] = dateString.split('-');
                const [year, time] = yearAndTime.split(' ');
                const [hours, minutes] = time.split(':');                        
                const notificationDate = new Date(year, month - 1, day, hours, minutes);
                notificationsDate.push([notificationDate,notification.layer,notification.node]);
                // Sort by the first element (date) in the sub-array
                notificationsDate.sort((a, b) => a[0] - b[0]);             
            });
            const notification = document.getElementById('notificationButton');
            notification.dataset.count = 0;
            // Dispatch custom event
            const event = new Event('countChange');
            notification.dispatchEvent(event);
        } 
        isLoading = false;   
        loadingSpinner.style.display = 'none'; 

        cancelList.length = 0;
        cancelIndex = 0;
        focusNode(closestNode());
   
       
        if(layerNumber === undefined && layer === 0){
            layer = 1;
        } else if (layer === 0){
            layer = layerNumber;
        }
        selectedLayer = layers.find(e => e.id === parseInt(layer, 10));
        layerNumber = layer;
        renderLayers();
    })
    .catch(error => {
        console.error('There was a problem with the fetch operation:', error);
    });
}

