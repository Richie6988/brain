let tunnel;
document.addEventListener('keydown', function(event) {
    const videoinput = Array.from(document.getElementsByClassName("videoinput"));
   
    if (event.key === 'Enter' && selectedNodes.length > 0 && !isTyping  && !overlay && videoinput.every(element => event.target !== element)) {
        if (displayTutorial) {
            selectedNodes[selectedNodes.length - 1].children[3].style.display = 'block'; 
            event.stopPropagation();
            return;
        }
        if (JSON.parse(selectedNodes[selectedNodes.length - 1].getAttribute('quantum')).length === 0) {    
            tunnel = true;
            copynodes(tunnel);
            selectedNodes[selectedNodes.length - 1].children[3].style.display = 'block'; 
            // if(!dark){
            //     selectedNodes[selectedNodes.length - 1].children[3].children[0].children[0].classList.remove('raydark');
            //     selectedNodes[selectedNodes.length - 1].children[3].children[0].children[0].classList.add('raylight');
            // }            
            // Reload the universe   
            createNewLayer();
            pastenodes(tunnel);   
            selectedNodes.length = 0;
            selectedLinks.length = 0;  
            
            // Dispatch mouse event on svg to prevent unfortunate dragging of node 
            // event = new MouseEvent('mouseup');
            // svg.dispatchEvent(event);  
        }     
    }
});


const dropdownContent = document.getElementById('dropdown-content');
const createLayerButton = document.getElementById('create-layer-btn');
const plusIcon = document.createElement('span');
plusIcon.textContent = '➕';
plusIcon.setAttribute('class', 'icon');   
plusIcon.style.marginLeft = '20px'
plusIcon.style.fontSize = '20px';
createLayerButton.appendChild(plusIcon);
const editModal = document.getElementById('edit-modal');
const trash = document.getElementById('delete-layer');
const edit = document.getElementById('edit');
const layerNameInput = document.getElementById('layer-name-input');
const dropdownButton = document.querySelector('.dropdown-button');
let editLayer = null;

// Create a new layer
function createNewLayer() {
    rebootUniverse();
    layerCounter += 1;
    const newLayer = {id: layerCounter, name: `Dim-${layerCounter}`};
    layers.push(newLayer);
    selectedLayer = newLayer;
    showEditModal(newLayer);
    dropdownContent.style.display = 'none'; 
    onLayerSelect(newLayer); 
    layerNumber = newLayer.id;
    saveLayers(); 
    if (quantum) {
        cancel();
        cancelList.length = 0;
        cancelIndex = 0;
        quantum = false;
    }
}

// Show modal to edit layer name
function showEditModal(layer) {
    colorWheelfo.setAttribute('visibility', 'hidden');
    isTyping = true;
    setTimeout(() => {
        editModal.style.display = 'flex';
        layerNameInput.focus();
    }, 10);
    editLayer = layer;
    layerNameInput.value = layer.name;  
 
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' && selectedNodes.length === 0 && editModal.style.display === 'flex' && !document.body.querySelector('.popup')) {
            saveLayerName();
            trash.style.display = 'none';
        }
    });
}

document.body.addEventListener('click', (e) => {
    var popup = document.body.querySelector('.popup');               
    // Close modal if clicked outside of the modal content
    if (!edit.contains(e.target)) { 
        if(popup && !popup.contains(e.target) && isLoggedIn) {
            console.log('aie')
            cancelEdit();  
            trash.style.display = 'none'; 
            document.body.removeChild(popup);
        } else if (!popup && editModal.style.display === 'flex') { 
            saveLayerName();
            trash.style.display = 'none'; 
        } 
    }
});

trash.addEventListener('click', () => {
    let popup = document.createElement('div');
    popup.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });
    popup.className = 'popup'; 
    popup.style.zIndex = 1000;
    const message = document.createElement('div');
    message.className = 'smallmessage';          
    message.textContent = `Are you sure? Deleting this dimension is permanent.`;
    popup.appendChild(message);
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'popupbutton-container'; 
    buttonContainer.style.justifyContent = 'center';
    const confirmButton = document.createElement('span');
    confirmButton.textContent = 'CONFIRM';
    confirmButton.style.fontSize = '10px';
    confirmButton.className = 'submit-button'; 
    confirmButton.style.padding = '5px';
    confirmButton.addEventListener('click', function() {
          // Delete layer
        const index = layers.findIndex(l => l.id === editLayer.id);
        if (index !== -1) {  // Ensure the layer exists in the array
            console.log(`Layer ${editLayer.id} deleted`);
            deleteLayer(editLayer,index);
        }             
        document.body.removeChild(popup);
        popup = null;
        cancelEdit()               
    });
    buttonContainer.appendChild(confirmButton);
    popup.appendChild(buttonContainer)
    document.body.appendChild(popup);

    popup.addEventListener('wheel', function(event) {
        event.preventDefault();
        // Handle scroll behavior manually if needed
    });                  
});

function onLayerSelect(layer,old) {
    if(layerNumber === layer.id){
        return;
    }
    layerNumber = layer.id;
    if (old){
      load(layer.id);
    } else {
      selectedLayer = layer;
      renderLayers();
      tunnel = true;
    }
    dropdownContent.style.display = 'none';
}

// Save edited layer name
function saveLayerName() {
    if (editLayer) {
        editLayer.name = layerNameInput.value;
        renderLayers();
        cancelEdit();
        saveLayers(); 
    }
}

// Cancel editing
function cancelEdit() {
    editModal.style.display = 'none';
    isTyping = false;
    if (tunnel === true){
        triggerSparkles();
    } 
}

// Toggle dropdown visibility
dropdownButton.addEventListener('click', () => {
    dropdownContent.style.display = dropdownContent.style.display === 'block' ? 'none' : 'block';
});

// Render layers in dropdown
function renderLayers() {
    dropdownContent.innerHTML = '';
    dropdownContent.appendChild(createLayerButton);
    const index = layers.findIndex(l => l.id === selectedLayer.id);
    if (index !== -1) {
        // Remove the selected layer from its current position
        const [selected] = layers.splice(index, 1);
        // Insert it in the first position
        layers.splice(0, 0, selected);
    }
    layers.forEach(layer => {
        const layerItem = document.createElement('div');
        layerItem.classList.add('dropdown-item');
        layerItem.textContent = layer.name;

        // If this is the selected layer, highlight it
        if (selectedLayer && layer.id === selectedLayer.id) {
            layerItem.style.backgroundColor = '#b89af2'; // Highlight color
        }
        // Add the edit icon
        const editIcon = document.createElement('span');
        editIcon.classList.add('edit-icon');
        editIcon.textContent = '✎';     
        editIcon.setAttribute('class', 'icon');   
  
        layerItem.addEventListener('click', (e) => {
            // If the clicked element is the editIcon or its children, don't trigger selection
            if (e.target === editIcon) {
                e.stopPropagation(); // Prevent triggering the layer selection
                showEditModal(layer);
                if (layer.id !== 1){
                    trash.style.display = 'block';  
                }                                         
            } else {
                // Otherwise, trigger the layer selection
                onLayerSelect(layer,'old');
            }
        });

        layerItem.appendChild(editIcon);
        dropdownContent.appendChild(layerItem);
    });
    dropdownButton.innerHTML = `${selectedLayer.name} <span>&#9662;</span>`;  
}

function saveLayers() {
    const data = [];
    layers.forEach(function(layer) {
      const layerid = layer.id;
      const layerName = layer.name;
      data.push({
          layerid: layerid,
          layername: layerName,
      });
    }); 
    data.push({
      layercounter: layerCounter,
      layer: layerNumber,
    });
    const csrfToken = getCookie('csrftoken');
    fetch('/save-layers/', {
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
    }).catch(error => {
        console.error('There was a problem with layers saving operation:', error);
    });
}

function deleteLayer(layer,index) {
    const data = [];   
    const layerid = layer.id;
    const layerName = layer.name;
    data.push({
        layerid: layerid,
        layername: layerName,
    });    
    const csrfToken = getCookie('csrftoken');
    fetch('/delete-layer/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken,
        },
        body: JSON.stringify(data),
    }).then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        } else {
            layers = layers.filter((_, i) => i !== index);
            selectedLayer = layers[layers.findIndex(l => l.name === 'Home')];
            onLayerSelect(selectedLayer,'old');
        }
        return response.json();
    }).catch(error => {
        console.error('There was a problem with deleting layer operation:', error);
    });
}

// Event listeners
createLayerButton.addEventListener('click', createNewLayer);

document.addEventListener('click', (e) => {
    // Close dropdown if clicked outside of the dropdown or button
    if (dropdownContent.style.display === 'block' && !dropdownContent.contains(e.target) && !dropdownButton.contains(e.target) && !edit.contains(e.target) && !document.body.querySelector('.popup')) {
        dropdownContent.style.display = 'none';
        isTyping = false;
        if (quantum) {
            cancel();
        }
    }  
});

function triggerSparkles() {
    const numSparkles = 320; // Adjust the number of sparkles
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;

    for (let i = 0; i < numSparkles; i++) {
      const angle = (Math.PI * 2 / numSparkles) * i;
      const sparkle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');

      // Randomize sparkle properties
      const distance = Math.random() * 2000 + window.innerWidth/2;  // Distance to travel
      const size = Math.random() * 5 + 1;  // Size of sparkle
      const x = centerX + distance * Math.cos(angle);
      const y = centerY + distance * Math.sin(angle);

      // Create sparkle
      sparkle.setAttribute('cx', centerX);
      sparkle.setAttribute('cy', centerY);
      sparkle.setAttribute('r', size);
      sparkle.setAttribute('class', 'sparkle');
      if (dark) {
        sparkle.style.fill = '#b89af2';
      } else {
        sparkle.style.fill = '#6848A6';
      }
      
      svg.appendChild(sparkle);

      // Animate sparkle
      sparkle.style.transformOrigin = `${centerX}px ${centerY}px`;
      sparkle.style.animationDelay = `${Math.random() * 0.5}s`;

      // Move it outward
      const move = sparkle.animate([
        { transform: `translate(0px, 0px) scale(0.1)`, opacity: 0 },
        { transform: `translate(${x - centerX}px, ${y - centerY}px) scale(1.2)`, opacity: 1 },
        { transform: `translate(${x - centerX}px, ${y - centerY}px) scale(0.1)`, opacity: 0 }
      ], {
        duration: 4000, // Duration of each sparkle animation
        easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)', // Smooth acceleration and deceleration
        fill: 'forwards',
        iterations: 1,
      });

      move.onfinish = () => {
        if(svg.contains(sparkle)){
          svg.removeChild(sparkle); // Remove sparkle after animation  
        }  
        const event = new MouseEvent('mouseup', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: 0,  
            clientY: 0
        });    
        // Dispatch the event to the element
        svg.dispatchEvent(event);      
      };
    }
    if (tunnel){
        if(document.querySelectorAll('.node-group')[0]){
            setTimeout(() => {
                document.querySelectorAll('.node-group')[0].style.visibility = 'visible';
            }, 700);
        }        
        tunnel = false;
    }
}

function keydownPortal(event) {
    if (!isTyping && (event.key === 'Delete' || event.key === 'Backspace')) {
        currentNode.children[3].style.display = 'none';
        const quantumData = JSON.parse(currentNode.getAttribute('quantum'));
        const id = quantumData[0].node;
        deleteQuantum(id);
        deleteQuantum(currentNode.id);
        currentNode.setAttribute('quantum', JSON.stringify([]));
        document.removeEventListener('keydown', keydownPortal);
    }
}