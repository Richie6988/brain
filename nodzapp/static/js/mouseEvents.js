///////////////////////////////////////////////////////////
////////////////////// MOUSE TRIGGERS /////////////////////
///////////////////////////////////////////////////////////

svg.addEventListener('mousedown', function(event) {    
    const buttonContainer = document.getElementById('button-container');
    const search = document.getElementById('semanticsearch');
    buttonContainer.classList.remove("show");
    search.blur();
    isTyping = false; 

    if(currentNode && !currentNode.tools.type.contains(event.target)) {        
        if (selectionArea(event, currentNode, 'up')) {
            initialdragX = event.clientX;    
            initialdragY = event.clientY;
            if(!colorWheelfo.contains(event.target) && !isSizing){
                isDragging = true;
                if(!selectedNodes.includes(currentNode) && !currentNode.tools.text.contains(event.target) && !currentNode.tools.file.contains(event.target) && !currentNode.tools.canvas.contains(event.target)){
                    event.stopPropagation();
                    nodeSelection(currentNode); 
                    svg.style.cursor = 'grabbing';
                    showParams(currentNode);
                    document.activeElement.blur();
                    isTyping = false;
                    currentNode.tools.type.children[3].setAttribute('visibility','hidden'); 
                    currentNode.tools.type.children[3].children[0].setAttribute('visibility','hidden');  
                } else if (!isCtrlPressed && selectedNodes.includes(currentNode) && !currentNode.tools.type.contains(event.target) && !colorWheelfo.contains(event.target)){
                    setTimeout(() => {
                        if (!isDragging && currentNode){
                            nodeUnselection(currentNode);   
                            setTimeout(() => {
                                currentNode.children[0].children[0].focus();
                            }, 10);                 
                        }
                    }, 300);
                }  
            }         
        } else if(!isCtrlPressed) {           
            if(svg !== event.target && !currentNode.tools.type.contains(event.target) && !colorWheelfo.contains(event.target) && !currentNode.children[3].contains(event.target)){  // le portail voyage, il n'ouvre pas le texte
                nodeUnselection(currentNode);
                setTimeout(() => {
                    currentNode.children[0].children[0].focus();
                }, 10);
            } else if(svg === event.target){      
                (Array.from(document.querySelectorAll('.node-group'))).forEach(node => {
                    nodeUnselection(node);
                    const canvasStyleGroup = node.tools.canvas;
                    canvasStyleGroup.setAttribute('visibility', 'hidden');
                }); 
                colorWheelfo.setAttribute('visibility', 'hidden');
                isTyping = false; 
                noCurrentNode(); 
                // // Get the selection
                var selection = window.getSelection();
                // Remove all ranges from the selection
                selection.removeAllRanges(); 
                document.activeElement.blur();    
            }                   
        }
    } else if(svg === event.target){      
        (Array.from(document.querySelectorAll('.node-group'))).forEach(node => {
            nodeUnselection(node);
        });            

    } else if (currentNode && currentNode.tools.type.children[3].contains(event.target) && currentNode.getAttribute('lock') === '0'){       
        isSizing = true;
        svg.style.cursor = 'grabbing';
        initialdragX = event.clientX;  
        quickSize(currentNode);  
    }               
});

// Cursors

svg.addEventListener('mousemove', function(event) {          
    // colorWheelfo est défini par interface.js, chargé après : absent pendant le chargement de la page.
    if(window.colorWheelfo?.getAttribute('visibility') === 'visible') {  
        return; 
    }
    if(currentNode) {  
        const sizeButtonfo = currentNode.tools.type.children[3];      
        if (selectionArea(event, currentNode, 'up')) {          
            svg.style.cursor = 'grab'; 
            if (!selectedNodes.includes(currentNode) && currentNode.getAttribute('lock') === '0') {
                currentNode.tools.type.style.display = 'block';
                sizeButtonfo.setAttribute('visibility','visible'); 
                sizeButtonfo.children[0].setAttribute('visibility','visible'); 
                const pathElement = sizeButtonfo.children[0].querySelector('path');
                pathElement.style.fill = currentNode.getAttribute('color');   
                quickSize(currentNode);
            }                   
        } else if (svg === event.target || currentNode.children[3].contains(event.target)){
            sizeButtonfo.setAttribute('visibility','hidden');
            sizeButtonfo.children[0].setAttribute('visibility','hidden');  
            svg.style.cursor = 'crosshair';    
        } else if(currentNode.getAttribute('type') === 'text'){
            svg.style.cursor = 'text';  
        } else {
            svg.style.cursor = 'pointer';  
        }
    } else{
        svg.style.cursor = 'crosshair';
    }
});


/// Templates
svg.addEventListener('mousedown', function(event) {  
    if(!event.target.closest('.template')){
        selectedTemplates.forEach(template => {
            const shapes = template.querySelectorAll('*:not(text)');
            shapes.forEach(shape => {
                shape.classList.remove('template-rect-hover');
            });
            template.children[0].style.display= 'none'; 
            template.children[2].style.display= 'none';     
        });
        selectedTemplates.length = 0;
    } 
});


//////////////////// NODE FOCUS ////////////////////

svg.addEventListener('dblclick', function(event) {
    if(currentNode) { 
        if (selectionArea(event, currentNode, 'up') && colorWheelfo.getAttribute('visibility') === 'hidden') {                     
            focusNode(currentNode,true);
        }
    }
});


//////////////////// DRAGGING THE whole interactive area ////////////////////

let layerDragging = false;

svg.addEventListener('mousedown', function(event) {    
    if (event.button === 0 && !isCtrlPressed) {
        if (!event.target.closest('.node-group') && !event.target.closest('canvas') && !isDragging) {
            event.preventDefault();
            layerDragging = true;    
            layerinitialX = event.clientX;
            layerinitialY = event.clientY;    
            dragX = 0;
            dragY = 0;    
        }
    }    
});

svg.addEventListener('mousemove', function(event) {          
    if (layerDragging) {        
        dragX = event.clientX -  layerinitialX;
        dragY = event.clientY -  layerinitialY;
        layerinitialX = event.clientX;
        layerinitialY = event.clientY;
        // Offset positions of visible nodeGroup elements
        dragUniverse(dragX,dragY,false);     
    }  
    isZooming = false; // Mandatory to keep zoom at pointer !
});

svg.addEventListener('mouseup', function(event) {       
    layerDragging = false;  
});


//////////////////// NODE SIZING ////////////////////

svg.addEventListener('mousemove', function(event) {
    if (isSizing && currentNode) {
        svg.style.cursor = 'grabbing';
        var sizeX = (event.clientX - initialdragX)/currentZoom;
        initialdragX = event.clientX; 
        
        let hitbox = currentNode.children[1];
        
        if (parseFloat(hitbox.getAttribute('r')) + sizeX > 20) {
            var d = ((parseFloat(hitbox.getAttribute('r')) + sizeX)* Math.sqrt(2));
            nodeSizing(currentNode,d,d); 
        }   
    }
});

svg.addEventListener('mouseup', function() {      
    if (isSizing) {        
        isSizing = false;            
        save(currentNode);
    }    
});

//////////////////// NODE DRAGGING ////////////////////

svg.addEventListener('mousemove', function(event) {
    if (isDragging) {
        event.preventDefault();
        svg.style.cursor = 'grabbing';
        dragX = event.clientX - initialdragX;
        dragY = event.clientY - initialdragY;
        initialdragX = event.clientX;
        initialdragY = event.clientY;
        dragSelected(dragX,dragY);             
        isMouseCloseToEdges(true);
        if (currentNode) {
            hideParams(currentNode); 
        }            
    }
});

svg.addEventListener('mouseup', function() {
    if (isDragging) {        
        isDragging = false;   
        save(currentNode);    
    }  
});


//////////////////// PREVENT WEB NATIVE BEHAVIOR ////////////////////

// Zoom du navigateur (pincement = Ctrl + molette) : bloqué ; le reste défile normalement dans les champs et panneaux
document.addEventListener('wheel', function(e) {
    if(!e.ctrlKey) {
        return;
    }
    e.preventDefault();
    e.stopPropagation();
}, { passive: false });


// Mouse down
document.getElementById('brand-container').addEventListener('mousedown', (event) => {
    event.preventDefault();
});


svg.addEventListener('mousedown', function(event) {
    if (svg === event.target){
        event.preventDefault();
    }    
});

// Context menu
document.addEventListener('contextmenu', function(event) {
    event.preventDefault();
});


//////////////////// INSIDE NODE ////////////////////

function selectionArea(event, nodeGroup, up) {
    if(!nodeGroup) return false;

    if (nodeGroup.getAttribute('shape') === 'square'){
        const rect = nodeGroup.children[2].getBoundingClientRect();
        const cx = rect.left + rect.width / 2; 
        const cy = rect.top + rect.height / 2; 
        var radius;
        if (up) {
            radius = parseFloat(Math.sqrt(2*(rect.width / 2)*(rect.width / 2))) + 10;
        } else {
            radius = parseFloat(Math.sqrt(2*(rect.width / 2)*(rect.width / 2)));
        }    

        // Calculate the Euclidean distance from the click point to the center
        const widthIn = event.clientX < cx+(rect.width/2) && event.clientX > cx-(rect.width/2);
        const heightIn = event.clientY < cy+(rect.height/2) && event.clientY > cy-(rect.height/2);
        const dx = event.clientX - cx;
        const dy = event.clientY - cy;
        const distance = Math.sqrt(dx * dx + dy * dy)/currentZoom;
        const test = (widthIn && heightIn && distance >= 0.5*radius) || (widthIn && heightIn && !nodeGroup.children[0].contains(event.target));

        return (test);

    } else {
        const rect = nodeGroup.children[1].getBoundingClientRect();
        const cx = rect.left + rect.width / 2; 
        const cy = rect.top + rect.height / 2; 
        var radius;
        if (up) {
            radius = parseFloat(nodeGroup.children[1].getAttribute('r')) + 10;
        } else {
            radius = parseFloat(nodeGroup.children[1].getAttribute('r'));
        }    

        // Calculate the Euclidean distance from the click point to the center
        const dx = event.clientX - cx;
        const dy = event.clientY - cy;
        const distance = Math.sqrt(dx * dx + dy * dy)/currentZoom;

        const test = (distance <= radius && distance >= 0.7*radius) || (distance <= radius && !nodeGroup.children[0].contains(event.target));

        return (test);
    }
}


function out(nodeGroup) {
    svg.addEventListener('mouseover', function(event) {
        if(!isDragging && editModal.style.display !== 'block' && !selectionArea(event, nodeGroup)){
            // nodeGroup.children[0].children[0].blur();
            // save(nodeGroup); 
            svg.style.cursor = 'crosshair';
            const fileGroup = nodeGroup.tools.file;         
            fileGroup.setAttribute('visibility', 'hidden');  
            
        } 
        if (selectionArea(event, nodeGroup)){
            if(!isSizing){
                CurrentNode(nodeGroup);
            }  
        }   
    }, { once: true });  
}