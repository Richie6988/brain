let isLoggedIn = false;
//////////////////// LOADING ////////////////////
// AUTO-LOAD 
var log = document.getElementById('log');
var loadingSpinner = document.createElement('div');
layer.appendChild(loadingSpinner);
loadingSpinner.className = 'waitingspinner';
loadingSpinner.id = 'loadingSpinner';
loadingSpinner.style.display = 'none';


function handleMutation(mutationsList, observer) {
    for (var mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.target === log) {
            // Content of userIDDiv has changed
            if (log.innerHTML === "register") { 
                setTimeout(load(-1), 100); 
                    
            } else if (log.innerHTML === "login") { 
                setTimeout(load(0), 100);
            } else if (log.innerHTML === "oldGuest") { 
                guestUser = false;
                document.getElementById('exportButton').className = 'export';
            }
            isLoggedIn = true;
            pendingLogin = false; 
        }
    }
}

var observer = new MutationObserver(handleMutation);
// Configure and start observing the log for changes in its content
var config = { childList: true };
observer.observe(log, config);



function referrer(rId){
    const csrfToken = getCookie('csrftoken');
    const data = [];
    data.push({ 
        referrer: rId, 
    })
    fetch('/referrer/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken,
        },
        body: JSON.stringify(data), 
    }).then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();   
    }).then(data => {      
   
    })
    .catch(error => {
        console.error('There was a problem with the fetch operation:', error);
    });
}
////////// LOAD ////////////


let isLoading = false;
function load(layer,nodeID){
    loadingSpinner.style.display = 'block';
    isLoading = true;
    selectedNodes.length = 0;
    players = [];
    currentNode = null;
    const csrfToken = getCookie('csrftoken');
    fetch('/loading/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken,
        },
        body: JSON.stringify({ layer: layer}), 
    }).then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();   
    }).then(data => {      
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


        if(document.getElementById('log').innerHTML === "register") {
            const urlParams = new URLSearchParams(window.location.search);
            const rId = urlParams.get('r'); // Extract 'r' parameter
            if (rId) {
                referrer(rId);
            }
        }
     
        if (quantum) {
            cancel();
            cancelList.length = 0;
            cancelIndex = 0;
            quantum = false;
        } else {
            cancelList.length = 0;
            cancelIndex = 0;
        }
        if (nodeID) {       
            focusNode(document.getElementById(nodeID));
            currentNode = document.getElementById(nodeID);
            if (seeNotification) {
                currentNode = document.getElementById(nodeID);
                currentNode.children[1].setAttribute('class', 'selectednode');
                currentNode.children[7].children[6].children[0].click();
                seeNotification = false;
            }
        } else {
            const nodeGroups = document.querySelectorAll('.node-group');
            focusNode(closestNode(nodeGroups));
           // dragUniverse(parseFloat(root.getAttribute('x'))-originX*currentZoom,-originY*currentZoom - parseFloat(root.getAttribute('y')));   
        }
        document.activeElement.blur();
        setTimeout(() => {
            dispatcher();    
        }, 100);
        
        if (layer > -1){
            if(layerNumber === undefined && layer === 0){
                layer = 1;
            } else if (layer === 0){
                layer = layerNumber;
            }
            selectedLayer = layers.find(e => e.id === parseInt(layer, 10));
            layerNumber = layer;
            renderLayers();
        }
    })
    .catch(error => {
        console.error('There was a problem with the fetch operation:', error);
    });
}

function rebootUniverse() {
    currentZoom = 1;             
    universe.innerHTML = '';
    root.setAttribute('x', 0);
    root.setAttribute('y', 0);
    universe.setAttribute('transform', `translate(${0},${0}) scale(${1})`);
    isTyping = false;
}

function displayNode(node) {
    const transfoX = node.x_coordinate*currentZoom - (parseFloat(root.getAttribute('x'))) + centerX;
    const transfoY = -node.y_coordinate*currentZoom + (parseFloat(root.getAttribute('y'))) + centerY;
    const id = `N-${node.node_id}`;  
    const newNode = createNode(transfoX,transfoY,id);
    newNode.children[1].setAttribute('r',node.radius)
    newNode.setAttribute('type', node.type);
    newNode.setAttribute('color', node.color);
    newNode.setAttribute('shape', node.shape);
    if(node.shape === 'none'){
        newNode.style.stroke = 'transparent';
        if (dark) {
            newNode.children[7].children[5].children[0].setAttribute('src', '/static/img/hide.svg');
        } else {
            newNode.children[7].children[5].children[0].setAttribute('src', '/static/img/hide-light.svg');
        }
    } else if(node.shape === 'circle') {
        newNode.style.stroke = node.color;
        if (dark) {
            newNode.children[7].children[5].children[0].setAttribute('src', '/static/img/circle.svg');
        } else {
            newNode.children[7].children[5].children[0].setAttribute('src', '/static/img/circle-light.svg');
        }
    }  else if(node.shape === 'square') {
        newNode.children[1].style.stroke = 'transparent';
        newNode.children[2].style.display = 'block';  
        newNode.children[2].setAttribute('class','squareShape');  
        if (dark) {
            newNode.children[7].children[5].children[0].setAttribute('src', '/static/img/square.svg');
        } else {
            newNode.children[7].children[5].children[0].setAttribute('src', '/static/img/square-light.svg');
        }
    } 
    newNode.setAttribute('layer', node.layer__layer_id);
    newNode.setAttribute('textcontent', node.text_content);
    newNode.setAttribute('imagecontent', node.image_content);
    newNode.children[0].children[1].src =  newNode.getAttribute('imagecontent');
    newNode.setAttribute('canvascontent', node.canvas_content);
    var drawingDataString = newNode.getAttribute('canvascontent');
    var drawingData = JSON.parse(drawingDataString);              
    redrawCanvas(newNode.children[0].children[4].id,0, drawingData);
    newNode.setAttribute('videocontent', node.video_content);
    newNode.setAttribute('videolink', node.video_link);
    newNode.children[0].children[3].children[1].value  =  newNode.getAttribute('videolink');
    newNode.setAttribute('filename', node.file_name);
    newNode.setAttribute('file', node.file);
    newNode.children[5].children[2].children[0].textContent = node.file_name;        
    const filePreview = newNode.children[0].children[2].children[0];
    const spinner = newNode.children[0].children[2].children[1];
    const fileContainer = newNode.children[0].children[2];
    if (node.file_name !== '') {
        loadFile(node.node, node.file_name, spinner, filePreview, fileContainer);
    }    
    newNode.setAttribute('notification', node.notification);
    if(newNode.getAttribute('notification') !== '') {
        newNode.children[7].children[6].children[0].setAttribute('src', '/static/img/notification.svg');
    }
  
    if(node.lock){
        newNode.setAttribute('lock', 1);
        if (dark) {
            newNode.children[7].children[7].children[0].setAttribute('src', '/static/img/lock.svg');
        } else {
            newNode.children[7].children[7].children[0].setAttribute('src', '/static/img/lock-light.svg');
        }
    } else {
        newNode.setAttribute('lock', 0);
        if (dark) {
            newNode.children[7].children[7].children[0].setAttribute('src', '/static/img/unlock.svg');
        } else {
            newNode.children[7].children[7].children[0].setAttribute('src', '/static/img/unlock-light.svg');
        }
    }
    newNode.setAttribute('quantum', node.quantum);
    if(JSON.parse(newNode.getAttribute('quantum')).length > 0){
        newNode.children[3].style.display = 'block';
    }

    newNode.children[0].children[0].innerHTML = node.text_content;
    newNode.children[7].children[0].children[0].value = newNode.getAttribute('type');  

    newNode.children[7].style.display = 'none';

    var r = parseFloat(newNode.children[1].getAttribute('r'));
    r = Math.sqrt(2*r*r);
    nodeSizing(newNode,r,r);

    var event = new Event('change');
    if(newNode.getAttribute('type') !== "text"){
        newNode.children[7].children[0].children[0].dispatchEvent(event);        
        const size = newNode.children[7].children[4];
        var event = new MouseEvent('mousedown');
        size.dispatchEvent(event);
        event = new MouseEvent('mouseup');
        svg.dispatchEvent(event);
    }
     
    document.activeElement.blur();
    save(newNode);
}

function displayLink(link) {
    const linkID = `L-${link.link_id}`;
    const node1 = document.getElementById(link.linkA);
    const node2 = document.getElementById(link.linkB);
    createLink(node1,node2,linkID); 
}

function displayTemplate(template) {
    templateID -= 1;
    const loadTemplate = createTemplate(parseInt(template.x_coordinate),parseInt(template.y_coordinate),template.type);
    loadTemplate.setAttribute('size', template.size);
    loadTemplate.setAttribute('templateID', template.template_id);
    loadTemplate.setAttribute('type', template.type);
    if(template.lock){
        loadTemplate.setAttribute('lock', 1);
        loadTemplate.children[2].children[0].setAttribute('src', '/static/img/lock-template.svg'); 
    } else {
        loadTemplate.setAttribute('lock', 0);
        loadTemplate.children[2].children[0].setAttribute('src', '/static/img/unlock-template.svg');
    }
}

let userID;
let pseudo;
let email;
let age;
let country;
let date_joined;
let premium;
let nodes = 0;
let text_nodes = 0;
let image_nodes = 0;
let file_nodes = 0;
let video_nodes = 0;
let sketch_nodes = 0;
function loadUser(param) {
    if (param.name === "username") {
        pseudo = param.value;
        console.log(pseudo)
    } else if (param.name === "id") {
        console.log(param.value)
        userID = param.value;        
    } else if (param.name === "admin") {
        console.log(param.value)
        if(param.value && !document.getElementById('admin-overlay')) {
            administration();
        }
        userID = param.value;        
    } else if (param.name === "email") {
        email = param.value;        
    } else if (param.name === "premium") {
        premium = param.value;
    } else if (param.name === "date_joined") {
        date_joined = param.value;
    } else if (param.name === "age") {
        age = param.value;
    } else if (param.name === "country") {
        country = param.value;
    } else if (param.name === "nodes") {
        nodes = param.value;
    } else if (param.name === "text_nodes") {
        text_nodes = param.value;
    } else if (param.name === "image_nodes") {
        image_nodes = param.value;
    } else if (param.name === "file_nodes") {
        file_nodes = param.value;
    } else if (param.name === "video_nodes") {
        video_nodes = param.value;
    } else if (param.name === "sketch_nodes") {
        sketch_nodes = param.value;
    } 
}

function loadParams(param) {
    const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: window,
    }); 
    if (param.name === "nodecounter") {
        nodeCounter = param.value;
    } else if (param.name === "linkcounter") {
        linkCounter = param.value;
    } else if (param.name === "layercounter") {
        layerCounter = param.value;
    } else if (param.name === "layer") {
        if (layerNumber === undefined) {
            layerNumber = param.value;
        }        
        selectedLayer = layers[layers.findIndex(l => l.id === layerNumber)];
        // Initialize layers and dropdown  
        renderLayers();
    } else if (param.name === "originX") {
        originX = param.value;    
    } else if (param.name === "originY") {
        originY = - param.value;
    } else if (param.name === "dark") {
        dark = !param.value;
        document.getElementById('darkButton').dispatchEvent(event);
    } else if (param.name === "sound") {
        sound = !param.value;  
        document.getElementById('soundButton').dispatchEvent(event);
    }  else if (param.name === "fullscreen") {
        fullscreen = !param.value;  
        document.getElementById('fullscreenButton').dispatchEvent(event);
    }  
}

function loadFile(nodeID, fileName, spinner, filePreview, fileContainer) {
    const csrfToken = getCookie('csrftoken');            
    fetch('/load-file/', {
        method: 'POST',
        headers: {
            'X-CSRFToken': csrfToken,
        },
        body: JSON.stringify({ nodeID: nodeID, fileName: fileName}), 
    }).then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
                    
        return response.blob(); // Clone the response and get response body as Blob
    }).then(blob => {
        if (fileName.endsWith('.stl')) {
            // STL file detected
            spinner.style.display = 'none';
            filePreview.style.display = 'none';
            var objectURL = window.URL.createObjectURL(blob);
     
            setTimeout(function() {
                openFile(blob, fileContainer);
            }, 100);
        } else {
            // Create an object URL from the Blob
            var objectURL = URL.createObjectURL(blob);
            const srcWithParams = objectURL + '#view=FitH&toolbar=1&navpanes=0&statusbar=0';
            filePreview.style.display = 'block';
            const match = nodeID.match(/\d+/);
            const number = match ? parseInt(match[0]) : null; 
            if (document.getElementById(`stlContainer-${number}`)) {
                document.getElementById(`stlContainer-${number}`).parentNode.removeChild(document.getElementById(`stlContainer-${number}`));
            }                         
            // Set the created PDF object as the src of the iframe
            filePreview.src = srcWithParams;
            spinner.style.display = 'none'; 
        }  
    })
    .catch(error => {
        console.error('Error fetching data:', error);
    });

}

//////////////////// SAVE ////////////////////

function save(nodeGroup,tunnel){
    if(admin){return}
    if(!isLoading && !displayTutorial){
        console.log(nodeGroup.id,' SAVED')
        const data = [];
        const id = parseInt(nodeGroup.id.match(/\d+/)[0], 10);
        const x = Math.round(nodeGroup.getAttribute('x'));
        const y = Math.round(nodeGroup.getAttribute('y'));
        const type = nodeGroup.getAttribute('type');
        const color = nodeGroup.getAttribute('color');
        const shape = nodeGroup.getAttribute('shape');
        const likes = nodeGroup.getAttribute('likes');
        const radius = nodeGroup.children[1].getAttribute('r');
        const layer = nodeGroup.getAttribute('layer');
        const textContent = nodeGroup.getAttribute('textcontent');
        const imgContent = nodeGroup.getAttribute('imagecontent');
        const videoLink = nodeGroup.getAttribute('videolink');
        const videoContent = nodeGroup.getAttribute('videocontent');
        const canvasContent = nodeGroup.getAttribute('canvascontent');
        const fileName = nodeGroup.getAttribute('filename');
        const file = nodeGroup.getAttribute('file');    
        const links = nodeGroup.getAttribute('links');
        const siblings = nodeGroup.getAttribute('siblings');
        const quantum = nodeGroup.getAttribute('quantum');
        const notification = nodeGroup.getAttribute('notification');   
        const lock = nodeGroup.getAttribute('lock');

        data.push({ 
            id: id, 
            x: x,
            y: y,
            type: type,
            color: color,
            shape: shape,
            likes: likes,
            radius: radius,
            layer: layer,
            textContent: textContent,
            imgContent: imgContent,
            videoLink: videoLink,
            videoContent: videoContent,
            canvasContent: canvasContent,
            links: links,
            siblings: siblings,
            quantum: quantum,
            fileName: fileName,
            file: file,
            notification: notification,
            lock: lock,
        });
        
        var monoLinks = JSON.parse(nodeGroup.getAttribute('links'));
       
        if (!tunnel) {      
            monoLinks.forEach(function(id) {
                const linkA = document.getElementById(id).getAttribute('Node1');
                const linkB = document.getElementById(id).getAttribute('Node2');

                data.push({
                    linkid: parseInt(id.match(/\d+/)[0], 10),
                    linkA: linkA,
                    linkB: linkB,
                    layer: document.getElementById(linkA).getAttribute('layer'),
                });
            });   
        }

        data.push({zoom: currentZoom,
            originX: Math.round(parseFloat(originX)),
            originY: Math.round(parseFloat(originY)),
            dark: dark,
            sound: sound,
            layer: layerNumber,
            fullscreen: fullscreen,
        })

        const csrfToken = getCookie('csrftoken');

        fetch('/save-node/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken,
            },
            body: JSON.stringify(data),
        }).then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            // Handle the response data
            // console.log('Success:', data);
        })
        .catch(error => {
            console.error('There was a problem with the fetch operation:', error);
        });
    }
}

// SAVE QUANTUM

function saveQuantum(id,tunnelid){  
    const data = [];
    const layer = layerNumber;
    
    data.push({ 
        node: parseInt(id.match(/\d+/)[0], 10), 
        tunnelid: tunnelid,
        layer: layer,
    });

    const csrfToken = getCookie('csrftoken');

    fetch('/save-quantum/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken,
        },
        body: JSON.stringify(data),
    }).then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();
    })
    .then(data => {
        // Update specific node quantum if in the same layer
        const updateData = data.update;
        const updateNode = document.getElementById(`N-${updateData.nodeid}`);
        if (updateNode) {
            updateNode.setAttribute('quantum',updateData.quantum)
        }
    })
    .catch(error => {
        console.error('There was a problem with the fetch operation:', error);
    });    
}

// DELETE QUANTUM

function deleteQuantum(id){  
    const data = [];
   
    data.push({ 
        id: parseInt(id.match(/\d+/)[0], 10),
    });

    const csrfToken = getCookie('csrftoken');

    fetch('/delete-quantum/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken,
        },
        body: JSON.stringify(data),
    }).then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response;
    })
    .catch(error => {
        console.error('There was a problem with the fetch operation:', error);
    });    
}


//////////////////// NODE DELETION ////////////////////
function deleteNode(nodes) {
    const data = [];
    let ids = [];
    if (cancelIndex > 0){
        cancelList.length = 0;
        cancelIndex = 0;
    }    
    cancelList.push(['deletion', Array.from(nodes).map(node => node.cloneNode(true))]);
    if (quantum){
        ids.length = 0;
        cancelList[0][1].forEach(node =>{
            ids.push(node.getAttribute('id'));
        });
    }   
    nodes.forEach(node =>{
        var linksArray = JSON.parse(node.getAttribute('links'));

        if(JSON.parse(node.getAttribute('quantum')).length > 0)  {
            const quantumData = JSON.parse(node.getAttribute('quantum'));
            const id = quantumData[0].node;
            if (document.getElementById(id)){
                document.getElementById(id).setAttribute('quantum',JSON.stringify([]));
                document.getElementById(id).children[3].style.display = 'none';
            } else if (!quantum) {
                deleteQuantum(id);
            } 
        }      

        linksArray.forEach(e => {
            data.push({linkid: parseInt(e.match(/\d+/)[0], 10)});
            const link = document.getElementById(e); 
            deleteLink(link);                          
            if(quantum){
                const node1InList = ids.includes(link.getAttribute('Node1'));
                const node2InList = ids.includes(link.getAttribute('Node2'));
                const nodeGroup1 = document.getElementById(link.getAttribute('Node1'));
                const nodeGroup2 = document.getElementById(link.getAttribute('Node2'));
                if (node1InList !== node2InList) { // Only one is in the list
                    if (!node1InList) {
                        cancelList[0][1].forEach(node => {
                            if (node.getAttribute('id') === link.getAttribute('Node2')) {
                                const linksConnexion = JSON.parse(node.getAttribute('links'));
                                const filteredIds = linksConnexion.filter(e => e !==link.id);
                                node.setAttribute('links', JSON.stringify(filteredIds));
                                const siblings = JSON.parse(node.getAttribute('siblings'));
                                const filteredSiblings = siblings.filter(e => e !== nodeGroup1.id);
                                node.setAttribute('siblings', JSON.stringify(filteredSiblings));
                            }
                        });
                    } else {
                        cancelList[0][1].forEach(node => {
                            if (node.getAttribute('id') === link.getAttribute('Node1')) {
                                const linksConnexion = JSON.parse(node.getAttribute('links'));
                                const filteredIds = linksConnexion.filter(e => e !==link.id);
                                node.setAttribute('links', JSON.stringify(filteredIds));
                                const siblings = JSON.parse(node.getAttribute('siblings'));
                                const filteredSiblings = siblings.filter(e => e !== nodeGroup2.id);
                                node.setAttribute('siblings', JSON.stringify(filteredSiblings));
                            }
                        });
                    }
                }  
            }
        });
        if(!quantum && !displayTutorial) {
            data.push({id: parseInt(node.getAttribute('id').match(/\d+/)[0], 10)}); 
        }
        players = players.filter((player, index) => index !== parseInt(node.getAttribute('id').match(/\d+/)[0], 10));
        universe.removeChild(node);                   
    });

    deleteFetch(data);
    selectedNodes.length = 0;        
}

function deleteFetch (data){
    const csrfToken = getCookie('csrftoken');
    // Set up headers
    const headers = {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken
    };
    // Set up fetch options
    const fetchOptions = {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
    };   
    // Make the fetch request
    fetch('/delete/', fetchOptions)
    .then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();
    })
    .catch(error => {
        // Handle error
        console.error('There was a problem with the fetch operation:', error);
    });
}