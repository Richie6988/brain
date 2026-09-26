//////////////////// DRAGGING SELECTED outside interactive area ////////////////////

// Function to check if mouse is close to document edges
function isMouseCloseToEdges(selection) {
    const edgeThreshold = 50; // Set the threshold for how close the mouse should be to trigger the popup (in pixels)

    const closeToTop = mouseY <= edgeThreshold;
    const closeToBottom = window.innerHeight - mouseY <= edgeThreshold;
    const closeToLeft = mouseX <= edgeThreshold;
    const closeToRight = window.innerWidth - mouseX <= edgeThreshold;

    if (closeToTop && !isMouseDown) {
        // Mouse is close to the top edge                  
        dragUniverse(0 , 1 , selection);    
        setTimeout(() => {isMouseCloseToEdges(true);}, 100);             
    }
    
    if (closeToBottom && !isMouseDown) {
        // Mouse is close to the bottom edge   
        dragUniverse(0 , -1 , selection);   
        setTimeout(() => {isMouseCloseToEdges(true);}, 100);        
    }
    
    if (closeToLeft && !isMouseDown) {
        // Mouse is close to the left edge       
        dragUniverse(1 , 0 , selection);  
        setTimeout(() => {isMouseCloseToEdges(true);}, 100);        
    }
    
    if (closeToRight && !isMouseDown) {
        // Mouse is close to the right edge    
        dragUniverse(-1 , 0 , selection);  
        setTimeout(() => {isMouseCloseToEdges(true);}, 100);         
    }   

}

//////////////////// TEXT STYLE ATTRIBUTES ////////////////////


function saveSelection() {
    var selection = window.getSelection();
    var range, length;
    if (selection.rangeCount > 0) {
        range = selection.getRangeAt(0);
        length = range.endOffset - range.startOffset;
        if (length === 0) {
            var spaceNode = document.createTextNode('\u00A0');
            // Add the space node to the end of the range
            range.insertNode(spaceNode);    
            // Expand the range to include the newly added space
            range.setStartBefore(spaceNode);
            range.setEndAfter(spaceNode);
            selection.addRange(range);
        }      
    }   
    return range;
}

function restoreSelection(savedSelection) {
    if (savedSelection) {
        var selection = window.getSelection();        
        //var range = savedSelection.getRangeAt(0);
        var length = savedSelection.endOffset - savedSelection.startOffset + 1;
        selection.removeAllRanges();
        if (length > 0) {
            selection.addRange(savedSelection);
        } else {
            var range = document.createRange();
            range.setStart(savedSelection.startContainer, savedSelection.startOffset);
            range.setEnd(savedSelection.startContainer, savedSelection.startOffset);
            selection.addRange(range);
        }           
    }
}




//////////////////// SELECTION OF NODES ////////////////////
var startX, startY;
var endX, endY;
var selectionBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
selectionBox.setAttribute('class', 'selectionBox');
svg.appendChild(selectionBox);

var isMouseDown = false;
var updateSelBox = false;

svg.addEventListener('mousedown', function(event) {
    let svgTarget = false;
    if (event.target === svg) {
        svgTarget = true;
    }
    if(svgTarget && event.button === 0 && !pendingLogin && isCtrlPressed){
        startX = event.clientX;
        startY = event.clientY;
        if(!justPaste) {
            isMouseDown = true;
            hideSelectionBox();
        } else {
            justPaste = false;
        }        
        
        event.preventDefault(); 
    } 
});

// Event listener for mousemove event to update selection
svg.addEventListener('mousemove', function(event) {
    mouseX = event.clientX; 
    mouseY = event.clientY;
    // updateArrowPosition(mouseX, mouseY);
   
    if (isMouseDown && isCtrlPressed) {   
        endX = event.clientX;
        endY = event.clientY;
        updateSelectionBox();
    }
});

// Event listener for mouseup event to end selection
svg.addEventListener('mouseup', function() {    
    if (isMouseDown) {
        isMouseDown = false;       
        if(isCtrlPressed){
            selectNodes(startX, startY, endX, endY);
        }
        hideSelectionBox();
    }    
});


// Function to update the selection box position and size
function updateSelectionBox() {
    var minX = Math.min(startX, endX);
    var minY = Math.min(startY, endY);
    var width = Math.abs(endX - startX);
    var height = Math.abs(endY - startY);

    selectionBox.setAttribute('x', minX  + 'px');
    selectionBox.setAttribute('y', minY  + 'px');
    selectionBox.setAttribute('width', width);
    selectionBox.setAttribute('height',height);
    updateSelBox = true;
}

// Function to hide the selection box
function hideSelectionBox() {
    selectionBox.setAttribute('width', 0);
    selectionBox.setAttribute('height',0);
    updateSelBox = false;
}

// Function to select the nodes
function selectNodes(startX, startY, endX, endY) {
    var selectionBoxX = Math.min(startX,endX);
    var selectionBoxY = Math.min(startY,endY);
    var selectionBoxRight = Math.max(startX,endX);
    var selectionBoxBottom = Math.max(startY,endY);

    const nodeGroups = document.querySelectorAll('.node-group');
    nodeGroups.forEach(node => {
        const nodeX = - Math.round(-parseFloat(node.getAttribute('x'))*currentZoom - centerX + parseFloat(root.getAttribute('x')));
        const nodeY = - Math.round(parseFloat(node.getAttribute('y'))*currentZoom - centerY - parseFloat(root.getAttribute('y')));
        if (
            (selectionBoxX < nodeX &&
            selectionBoxRight > nodeX &&
            selectionBoxY < nodeY &&
            selectionBoxBottom > nodeY) 
        ) {           
            nodeSelection(node);
        }
    });
    // Templates selection
    const templates = document.querySelectorAll('.template');
    templates.forEach(template => {
        const templateX = - Math.round(-parseFloat(template.getAttribute('x'))*currentZoom - centerX + parseFloat(root.getAttribute('x')));
        const templateY = - Math.round(parseFloat(template.getAttribute('y'))*currentZoom - centerY - parseFloat(root.getAttribute('y')));
        if (
            (selectionBoxX < templateX &&
            selectionBoxRight > templateX &&
            selectionBoxY < templateY &&
            selectionBoxBottom > templateY) 
        ) {         
        const shapes = template.querySelectorAll('*:not(text)');                
        shapes.forEach(shape => {
            // Apply the hover effect: bigger stroke and color change
            shape.classList.add('template-rect-hover');  
        });
        if (!selectedTemplates.includes(template)) {
            selectedTemplates.push(template);
        }  
        }
    });
}


//////////////////// SEMENTIC SEARCH ////////////////////



let semanticsearch = document.getElementById('semanticsearch');
let prevsearch = document.getElementById('prevsearch');
let nextsearch = document.getElementById('nextsearch');
//let results = document.getElementById('results');
let resultsprio = 0;

semanticsearch.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {  // Check if Enter key is pressed
        event.preventDefault();  // Prevent form submission if inside a form
        const data = [{
            search: semanticsearch.value
        }];
        searchrequest(data);
    }
});
semanticsearch.addEventListener('mousedown', function() {
    isTyping = true; 
});


function searchrequest(data){
    const csrfToken = getCookie('csrftoken');
    resultsprio = 0;
   
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
    fetch('/semantic-search/', fetchOptions)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(responseData => {
            // Handle success

            const rankedNodes = responseData.ranked_nodes;
            console.log(rankedNodes)
            if (rankedNodes[resultsprio] && rankedNodes[resultsprio].matching_score != 0) {
                 /// Display result
                focus = false;
                const node = document.getElementById('N-'+rankedNodes[resultsprio].id);
                if (node) {
                    focusNode(node,true);
                } else {
                    load(rankedNodes[resultsprio].layer,'N-'+rankedNodes[resultsprio].id)
                }
                
            }

            prevsearch.addEventListener('mousedown', function() {
                resultsprio -=1
                if (rankedNodes[resultsprio] && rankedNodes[resultsprio].matching_score != 0) {
                    /// Display result
                   focus = false;
                   const node = document.getElementById('N-'+rankedNodes[resultsprio].id);
                    if (node) {
                        focusNode(node,true);
                    } else {
                        load(rankedNodes[resultsprio].layer,'N-'+rankedNodes[resultsprio].id)
                    }
               } else { resultsprio +=1}
            });
            nextsearch.addEventListener('mousedown', function() {
                resultsprio +=1
                if (rankedNodes[resultsprio] && rankedNodes[resultsprio].matching_score != 0) {
                    /// Display result
                   focus = false;
                   const node = document.getElementById('N-'+rankedNodes[resultsprio].id);
                    if (node) {
                        focusNode(node,true);
                    } else {
                        load(rankedNodes[resultsprio].layer,'N-'+rankedNodes[resultsprio].id)
                    }
               } else { resultsprio -=1}
            });
     
        })
        .catch(error => {
            // Handle error
            console.error('There was a problem with the fetch operation:', error);
        });

}



function focusNode(node,val){
    if (node){
        isFocused = true;
        if(val){
            var wheelEvent = new WheelEvent('wheel', {
                clientX: centerX,
                clientY: centerY,
                deltaX: 0, // Horizontal scroll amount
                deltaY: -1, // Vertical scroll amount (positive for scrolling down)
            
            });
        
            while (currentZoom <= 1) {
                zoom(wheelEvent)
            }
        }
        const originX = (parseFloat(root.getAttribute('x')))/currentZoom;
        const originY = (-parseFloat(root.getAttribute('y')))/currentZoom;

        const nodeX = parseFloat(node.getAttribute('x'));
        const nodeY = parseFloat(node.getAttribute('y'));   

        const transfoX =  windowWidthCorrec/2 + (originX - nodeX)*currentZoom;
        const transfoY = windowHeightCorrec/2 + (originY + nodeY)*currentZoom;
        noCurrentNode();
        dragUniverse(transfoX,transfoY); 
        // setTimeout(() => {
        //     document.activeElement.blur(); 
        // }, 250);        
    } 

}

//////////////////// EXTERNAL LINKS GESTION ////////////////////

window.addEventListener('click', function(event) {
    // Check if the clicked element is a link
    if (event.target.tagName === 'A') {
        if(internalLink){
            internalLink = false;
            return;
        }
        // Check if the link is external
        if (isExternalLink(event.target.href)) {
            // Prevent the default behavior (opening external link)
            event.preventDefault();
            let popup = document.createElement('div');
            popup.addEventListener('contextmenu', (event) => {
                event.preventDefault();
            });
            popup.className = 'popup'; 
            const message = document.createElement('div');
            message.className = 'smallmessage';          
            message.textContent = `Open external link?`;
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
                window.open(event.target.href, '_blank');
                closePopup();
            });
            buttonContainer.appendChild(confirmButton);

            popup.appendChild(buttonContainer)
            document.body.appendChild(popup);

            popup.addEventListener('wheel', function(event) {
                event.preventDefault();
                // Handle scroll behavior manually if needed
            });
        
            svg.addEventListener('mousedown', function() {
                if (popup) {
                    closePopup();    
                }
            });
        
            function closePopup() {
                document.body.removeChild(popup);
                popup = null;
            }
        
        } 
    }
});

// Function to check if a link is external
function isExternalLink(url) {
    // Create a temporary anchor element
    const anchor = document.createElement('a');
    anchor.href = url;
    // Check if the hostname of the link is different from the current hostname
    return anchor.hostname !== window.location.hostname;
}


//////////////////// NODE SELECTION ////////////////////

function nodeSelection(node){   
    if (!selectedNodes.includes(node)) {
        selectedNodes.push(node); 
        node.children[2].style.stroke = '#f3ee58'; 
        node.children[1].style = '';           
    }  
    
    if(currentNode === node) {
        node.children[1].style.strokeWidth = '7px'; 
        node.children[2].style.strokeWidth = '7px';
    }

    if(node.getAttribute('shape') === 'square') {
        node.children[1].style.stroke = 'transparent';
        node.children[2].setAttribute('class', 'selectednode');  
    } else if(node.getAttribute('shape') === 'none'){
        node.children[1].style.stroke = '#f3ee58';  
        node.children[1].setAttribute('class', 'selectednode');      
    } else if(node.getAttribute('shape') === 'circle'){
        node.children[1].setAttribute('class', 'selectednode');      
    }
   
}

function nodeUnselection(node){
    selectedNodes = selectedNodes.filter((n) => n !== node);
    hideParams(node);
    node.children[1].setAttribute('class', 'hitbox'); 
    node.children[2].setAttribute('class', 'hitbox');              
    if(node.getAttribute('shape') === 'none'){
        node.children[1].style.stroke = 'transparent';         
    } else if(node.getAttribute('shape') === 'circle'){
        node.children[1].style.strokeWidth = '4px';    
        node.children[1].style.stroke = node.getAttribute('color');    
    } else if(node.getAttribute('shape') === 'square'){
        node.children[2].style.strokeWidth = '4px';
        node.children[2].style.stroke = node.getAttribute('color'); 
    }
    node.children[7].style.display = 'none';
}

let paramColor = 'rgba(39, 9, 39, 0.5)';
let paramColorLight = 'rgba(232, 232, 232, 0.5)';

function showParams(nodeGroup) {    
    const typeGroup = nodeGroup.children[7];
    const typeButtonfo = nodeGroup.children[7].children[0];
    const typeButton = nodeGroup.children[7].children[1];
    const colorButtonfo = nodeGroup.children[7].children[2];
    const shapeButtonfo = nodeGroup.children[7].children[5];
    const calendarButtonfo = nodeGroup.children[7].children[6];
    const lockButtonfo = nodeGroup.children[7].children[7];
    const layerButtonfo = nodeGroup.children[7].children[8];

    typeButton.style.pointerEvents = 'auto';
    const canvasStyleGroup = nodeGroup.children[6];
    canvasStyleGroup.setAttribute('visibility', 'hidden');

    typeGroup.style.display ='block';
    typeButtonfo.setAttribute('visibility', 'visible');
    typeButton.setAttribute('visibility', 'visible');
    colorButtonfo.setAttribute('visibility', 'visible');
    shapeButtonfo.setAttribute('visibility', 'visible');
    calendarButtonfo.setAttribute('visibility', 'visible');
    lockButtonfo.setAttribute('visibility', 'visible');
    layerButtonfo.setAttribute('visibility', 'visible');  

    if(dark){
        if(nodeGroup.getAttribute('shape') === 'square') {  
            nodeGroup.children[1].style.fill = 'none';     
            nodeGroup.children[2].style.fill = paramColor; 
        } else {
            nodeGroup.children[1].style.fill = paramColor;
            nodeGroup.children[2].style.fill = 'none';
        }        
    } else {
        if(nodeGroup.getAttribute('shape') === 'square') {
            nodeGroup.children[1].style.fill = 'none';
            nodeGroup.children[2].style.fill = paramColorLight; 
        } else {
            nodeGroup.children[1].style.fill = paramColorLight;
            nodeGroup.children[2].style.fill = 'none';
        }      
    }
}

function hideParams(nodeGroup) {
    const typeButtonfo = nodeGroup.children[7].children[0];
    const typeButton = nodeGroup.children[7].children[1];
    const colorButtonfo = nodeGroup.children[7].children[2];
    const shapeButtonfo = nodeGroup.children[7].children[5];
    const calendarButtonfo = nodeGroup.children[7].children[6];
    const lockButtonfo = nodeGroup.children[7].children[7];
    const layerButtonfo = nodeGroup.children[7].children[8];

    typeButtonfo.setAttribute('visibility', 'hidden');
    typeButton.setAttribute('visibility', 'hidden');
    colorButtonfo.setAttribute('visibility', 'hidden');
    shapeButtonfo.setAttribute('visibility', 'hidden');
    calendarButtonfo.setAttribute('visibility', 'hidden');
    lockButtonfo.setAttribute('visibility', 'hidden');
    layerButtonfo.setAttribute('visibility', 'hidden');  
            
    nodeGroup.children[1].style.fill = 'none';
    nodeGroup.children[2].style.fill = 'none';
}

function CurrentNode(node) {
    currentNode = node;
}

function noCurrentNode() {   
    if(!currentNode){ return;}
    if (currentNode.children[1].classList[0] === 'hitbox') {
        currentNode.children[1].style.strokeWidth = '4px';
        currentNode.children[2].style.strokeWidth = '4px';
    }
    out(currentNode);
    currentNode = null;
}


///////////// NODE SIZING ///////////////

// document.addEventListener('nodeSizing', function() { // Update colorWheel position and other buttons while universe is dragging
//     if (currentNode) {  
//         let hitbox = currentNode.children[1];   
//         var r = parseFloat(hitbox.getAttribute('r'));
//         r = Math.sqrt(2*r*r);
//         nodeSizing(currentNode,r,r); 
//     }
// });

function nodeSizing(nodeGroup,w,h) {  
    var screenSize = window.innerHeight*2;
    if ((w > screenSize || h > screenSize)) {
        console.log('max node size')
        w = screenSize;
        h = screenSize;
    }

    let foreignObject = nodeGroup.children[0];

    foreignObject.setAttribute('width', w);
    foreignObject.setAttribute('height',h);  

    let input = nodeGroup.children[0].children[0];
  
    input.style.bottom = (foreignObject.getAttribute('height') - input.scrollHeight)/2 +'px';
    input.style.width = '100%';

    if (nodeGroup.getAttribute('type') === 'video' || nodeGroup.getAttribute('type') === 'canvas') {
        w = Math.max(w,200);
        h = Math.max(h,200);            
    } else  if(nodeGroup.getAttribute('textcontent') === '') {
        w = Math.max(w,125);
        h = Math.max(h,125);          
    }

    let img = nodeGroup.children[0].children[1];
    var nw = img.naturalWidth;
    var nh = img.naturalHeight;
    var expectedSrc = '/static/img/newimg';
    let square = nodeGroup.children[2];
    var reduction_factor = 0;
    var hitboxRadius = Math.round(Math.sqrt(w * h / 2));

    if (nodeGroup.getAttribute('type') === 'image' && img.src.includes(expectedSrc)) {           
        foreignObject.setAttribute('width', '30px');
        foreignObject.setAttribute('height','30px');                 
    } else if (nodeGroup.getAttribute('type') === 'image') {
        if (nw > nh) {
            foreignObject.setAttribute('width', w);
            foreignObject.setAttribute('height',w*nh/nw); 
            square.setAttribute('width', w); 
            square.setAttribute('height', w*nh/nw);
            if (nodeGroup.getAttribute('shape') === 'square'){
                reduction_factor = 2*hitboxRadius - w; 
            }                     
        } else if (nw < nh) {
            foreignObject.setAttribute('width', h*nw/nh);
            foreignObject.setAttribute('height',h); 
            square.setAttribute('width', h*nw/nh); 
            square.setAttribute('height', h);
            if (nodeGroup.getAttribute('shape') === 'square'){
                reduction_factor = 2*hitboxRadius - h*nw/nh; 
            }               
        }           
    } else if (nodeGroup.getAttribute('type') === 'text' && nodeGroup.getAttribute('shape') === 'square') {
        square.setAttribute('width', w + 30); 
        square.setAttribute('height', input.scrollHeight + 30);
        reduction_factor = 2*hitboxRadius - w - 30; 
    } else {
        square.setAttribute('width', 2 * hitboxRadius); 
        square.setAttribute('height', 2 * hitboxRadius);
    }
    
    let canvas = nodeGroup.children[0].children[4];
    if (nodeGroup.getAttribute('type') === 'canvas' && (w > parseFloat(canvas.getAttribute('width')) || h > parseFloat(canvas.getAttribute('height')))) {
        console.log('max canvas size')
        return;
    } else if (nodeGroup.getAttribute('type') === 'canvas'){
        w = Math.max(w,150);
        h = Math.max(h,150); 
       
        foreignObject.setAttribute('width', w);
        foreignObject.setAttribute('height',h);  
    }   

    square.setAttribute('x', centerX -  parseFloat(square.getAttribute('width'))/2);
    square.setAttribute('y', centerY - parseFloat(square.getAttribute('height'))/2);

    let hitbox = nodeGroup.children[1];
    hitbox.setAttribute('r', hitboxRadius);
         
    // TEXT INPUT 
    
    let boldButtonfo = nodeGroup.children[4].children[0];
    let italicButtonfo = nodeGroup.children[4].children[1];
    let underlineButtonfo = nodeGroup.children[4].children[2];
    let fontSizeButtonfo = nodeGroup.children[4].children[3];
    let textColorButtonfo = nodeGroup.children[4].children[4];
    let smileyButtonfo = nodeGroup.children[4].children[5];

    if(nodeGroup.getAttribute('shape') === 'square') { 
        const shift = (input.scrollHeight + 40)/2;       
        boldButtonfo.setAttribute('x', centerX -38); 
        boldButtonfo.setAttribute('y', centerY + shift);

        italicButtonfo.setAttribute('x', centerX - 18); 
        italicButtonfo.setAttribute('y', centerY + shift);
        
        underlineButtonfo.setAttribute('x', centerX + 2); 
        underlineButtonfo.setAttribute('y', centerY + shift);

        fontSizeButtonfo.setAttribute('x', centerX - 60); 
        fontSizeButtonfo.setAttribute('y', centerY + shift);

        textColorButtonfo.setAttribute('x', centerX + 20); 
        textColorButtonfo.setAttribute('y', centerY + shift - 3);

        smileyButtonfo.setAttribute('x', centerX + 41); 
        smileyButtonfo.setAttribute('y', centerY + shift - 2);  

    } else {        
        boldButtonfo.setAttribute('x', centerX -38); 
        boldButtonfo.setAttribute('y', centerY + 0.7*hitboxRadius - 7);

        italicButtonfo.setAttribute('x', centerX - 18); 
        italicButtonfo.setAttribute('y', centerY + 0.7*hitboxRadius- 7);
        
        underlineButtonfo.setAttribute('x', centerX + 2); 
        underlineButtonfo.setAttribute('y', centerY + 0.7*hitboxRadius- 7);

        fontSizeButtonfo.setAttribute('x', centerX - 60); 
        fontSizeButtonfo.setAttribute('y', centerY + 0.7*hitboxRadius- 7);

        textColorButtonfo.setAttribute('x', centerX + 20); 
        textColorButtonfo.setAttribute('y', centerY + 0.7*hitboxRadius - 10);

        smileyButtonfo.setAttribute('x', centerX + 41); 
        smileyButtonfo.setAttribute('y', centerY + 0.7*hitboxRadius - 9);  
    }


    // FILE

    let fileButton1fo = nodeGroup.children[5].children[0];
    let fileButton2fo = nodeGroup.children[5].children[1];
    let fileButton3fo = nodeGroup.children[5].children[2];
    let filePreview = nodeGroup.children[0].children[2].children[0];
    let fileTypeImg = nodeGroup.children[0].children[2].children[2];

    fileButton3fo.style.width = w;  
    truncateMiddleText(nodeGroup.getAttribute('filename'),fileButton3fo.children[0], w/11);

    if(filePreview.src === '' && (typeof fileTypeImg === "undefined" || fileTypeImg.src === '')){
        fileButton1fo.setAttribute('x', centerX - 11); 
        fileButton1fo.setAttribute('y', centerY - 11);
        fileButton1fo.style.width ='22px';
        fileButton1fo.style.height ='22px';

        fileButton2fo.style.display ='none';
        fileButton3fo.style.display ='none';

        fileButton3fo.setAttribute('x', centerX-parseFloat(fileButton3fo.style.width)/2);
        fileButton3fo.setAttribute('y', centerY - 0.9*hitboxRadius);

    } else {
        fileButton1fo.style.width ='22px';
        fileButton1fo.style.height ='22px';
        fileButton1fo.setAttribute('x', centerX -38); 
        fileButton1fo.setAttribute('y', centerY + 0.8*hitboxRadius - 10);

        fileButton2fo.style.display ='block';
        fileButton3fo.style.display ='block';
        fileButton2fo.setAttribute('x', centerX +22); 
        fileButton2fo.setAttribute('y', centerY + 0.8*hitboxRadius - 10);

        fileButton3fo.setAttribute('x', centerX-parseFloat(fileButton3fo.style.width)/2);
        fileButton3fo.setAttribute('y', centerY - 0.9*hitboxRadius);
    }
    
  
    // CANVAS

    let canvasEraserButtonfo = nodeGroup.children[6].children[0];
    let canvasRedoButtonfo = nodeGroup.children[6].children[1];
    let canvasUndoButtonfo = nodeGroup.children[6].children[2];
    let canvasClearButtonfo = nodeGroup.children[6].children[3];
    let canvasLineButtonfo = nodeGroup.children[6].children[4];
    let canvasCircleButtonfo = nodeGroup.children[6].children[5];
    let canvassliderfo = nodeGroup.children[6].children[6];
    let canvasColorButtonfo = nodeGroup.children[6].children[7];

    canvasEraserButtonfo.setAttribute('x', centerX - hitboxRadius - 20); 
    canvasEraserButtonfo.setAttribute('y', centerY + 0);

    canvasRedoButtonfo.setAttribute('x', centerX - hitboxRadius - 20); 
    canvasRedoButtonfo.setAttribute('y', centerY + 30);

    canvasUndoButtonfo.setAttribute('x', centerX - hitboxRadius - 50); 
    canvasUndoButtonfo.setAttribute('y', centerY + 30);

    canvasClearButtonfo.setAttribute('x', centerX - hitboxRadius - 50); 
    canvasClearButtonfo.setAttribute('y', centerY + 0);

    canvasLineButtonfo.setAttribute('x', centerX - hitboxRadius - 20); 
    canvasLineButtonfo.setAttribute('y', centerY - 30);

    canvasCircleButtonfo.setAttribute('x', centerX - hitboxRadius - 50); 
    canvasCircleButtonfo.setAttribute('y', centerY - 30);     
 
    canvassliderfo.setAttribute('x', centerX - hitboxRadius - 30); 
    canvassliderfo.setAttribute('y', centerY - 60);

    canvasColorButtonfo.setAttribute('x', centerX - hitboxRadius - 53); 
    canvasColorButtonfo.setAttribute('y', centerY -60);

    // VIDEO

    let videoinput = nodeGroup.children[0].children[3].children[1];
    let leftButton = nodeGroup.children[0].children[3].children[2];
    let rightButton = nodeGroup.children[0].children[3].children[3];

    videoinput.setAttribute('x', centerX ); 
    videoinput.setAttribute('y', centerY + 0.9*hitboxRadius);

    leftButton.setAttribute('x', centerX -100); 
    leftButton.setAttribute('y', centerY + 0.9*hitboxRadius);

    rightButton.setAttribute('x', centerX +100); 
    rightButton.setAttribute('y', centerY + 0.9*hitboxRadius);


    // NODE PARAMS 
    let typeButtonfo = nodeGroup.children[7].children[0];
    let typeButton = nodeGroup.children[7].children[1];
    let colorButtonfo = nodeGroup.children[7].children[2];
    let sizeButtonfo = nodeGroup.children[7].children[3];
    let sizeButton = nodeGroup.children[7].children[4];
    let shapeButtonfo = nodeGroup.children[7].children[5];
    let calendarButtonfo = nodeGroup.children[7].children[6];
    let lockButtonfo = nodeGroup.children[7].children[7];
    let layerButtonfo = nodeGroup.children[7].children[8];

    if(nodeGroup.getAttribute('shape') === 'square') {
        const shift = (input.scrollHeight + 40)/2;
        typeButtonfo.setAttribute('x', centerX - 27); 
        typeButtonfo.setAttribute('y', centerY - shift - 26);
        typeButton.setAttribute('x', centerX - 27); 
        typeButton.setAttribute('y', centerY - shift - 26);
    
        colorButtonfo.setAttribute('x', centerX - 15); 
        colorButtonfo.setAttribute('y', centerY + shift);
        colorButtonfo.style.width = 30;
        colorButtonfo.style.height = 30;
        
        shapeButtonfo.setAttribute('x', centerX - 50); 
        shapeButtonfo.setAttribute('y', centerY + shift);
        shapeButtonfo.style.width = 26;
        shapeButtonfo.style.height = 26;
        
        calendarButtonfo.setAttribute('x', centerX + 27); 
        calendarButtonfo.setAttribute('y', centerY + shift);
        calendarButtonfo.style.width = 26;
        calendarButtonfo.style.height = 26;

        lockButtonfo.setAttribute('x', centerX + 31); 
        lockButtonfo.setAttribute('y', centerY - shift - 26);
        lockButtonfo.style.width = 26;
        lockButtonfo.style.height = 26;

        layerButtonfo.setAttribute('x', centerX - 52); 
        layerButtonfo.setAttribute('y', centerY - shift - 26);
        layerButtonfo.style.width = 26;
        layerButtonfo.style.height = 26;

    } else {
        typeButtonfo.setAttribute('x', centerX - 27); 
        typeButtonfo.setAttribute('y', centerY - 55);
        typeButton.setAttribute('x', centerX - 27); 
        typeButton.setAttribute('y', centerY - 55);
    
        colorButtonfo.setAttribute('x', centerX - 15); 
        colorButtonfo.setAttribute('y', centerY + 30);
        colorButtonfo.style.width = 30;
        colorButtonfo.style.height = 30;
        
        shapeButtonfo.setAttribute('x', centerX - 50); 
        shapeButtonfo.setAttribute('y', centerY + 10);
        shapeButtonfo.style.width = 26;
        shapeButtonfo.style.height = 26;
        
        calendarButtonfo.setAttribute('x', centerX + 27); 
        calendarButtonfo.setAttribute('y', centerY + 8);
        calendarButtonfo.style.width = 26;
        calendarButtonfo.style.height = 26;

        lockButtonfo.setAttribute('x', centerX + 31); 
        lockButtonfo.setAttribute('y', centerY - 25);
        lockButtonfo.style.width = 26;
        lockButtonfo.style.height = 26;

        layerButtonfo.setAttribute('x', centerX - 52); 
        layerButtonfo.setAttribute('y', centerY - 25);
        layerButtonfo.style.width = 26;
        layerButtonfo.style.height = 26;
    }

    sizeButtonfo.setAttribute('x', centerX + hitboxRadius - reduction_factor/2 - 17);//Math.min(Math.max(13,13/currentZoom),75)); 
    sizeButtonfo.setAttribute('y', centerY - 7);//Math.min(Math.max(13,13/currentZoom),75));
    sizeButton.setAttribute('x', centerX  + hitboxRadius  - reduction_factor/2 - 13);//Math.min(Math.max(13,13/currentZoom),75)); 
    sizeButton.setAttribute('y', centerY - 13);//Math.min(Math.max(13,13/currentZoom),75));
    sizeButton.style.width = 26;//Math.min(Math.max(26,26/currentZoom),150);
    sizeButton.style.height = 26;//Math.min(Math.max(26,26/currentZoom),150);
    sizeButtonfo.style.width = 26;//Math.min(Math.max(26,26/currentZoom),150);
    sizeButtonfo.style.height = 26;//Math.min(Math.max(26,26/currentZoom),150);


    // Adjust foreignObject position
    foreignObject.setAttribute('x', centerX - parseFloat(foreignObject.getAttribute('width'))/2);
    foreignObject.setAttribute('y', centerY - parseFloat(foreignObject.getAttribute('height'))/2);

    // COLORWHEEL
   
    colorWheelfo.setAttribute('width', 2*hitboxRadius*currentZoom);
    colorWheelfo.setAttribute('height', 2*hitboxRadius*currentZoom); 
    const nodeRect = nodeGroup.children[1].getBoundingClientRect();
    const x = nodeRect.x;
    const y = nodeRect.y;
    colorWheelfo.setAttribute('transform', `translate(${x}, ${y})`);
    picker.setSize(2*hitboxRadius*currentZoom); 

    // PORTAL
    let quantumButtonfo = nodeGroup.children[3];
    quantumButtonfo.setAttribute('x', centerX - 0.71*hitboxRadius - 30); 
    quantumButtonfo.setAttribute('y', centerY - 0.71*hitboxRadius - 30);
    quantumButtonfo.style.width = 33;
    quantumButtonfo.style.height = 33;


    // UPDATE LINKS
 
    var links = JSON.parse(nodeGroup.getAttribute('links') || '[]');
          
    links.forEach(id => {
        const link = document.getElementById(id);
        updateLink(link);             
    }); 
}

function quickSize(nodeGroup){
    var r = parseFloat(nodeGroup.children[1].getAttribute('r'));
    r = Math.sqrt(2*r*r);
    nodeSizing(nodeGroup,r,r);
}

//////////////////// NODE ANIMATION ////////////////////

function flipCoin(nodeGroup,duration = 1123) {
    let startTime;

    function rotate(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsedTime = timestamp - startTime;

        // Calculate the rotation angle as a percentage of 360 degrees
        var rotationAngle = (elapsedTime / duration) * 360;
   
        const transformAttr = nodeGroup.getAttribute('transform');
        const transformRegex = /translate\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)\s*scale\((-?\d+\.?\d*)\)/;                          
        const match = transformAttr.match(transformRegex);
        var transfoX = parseFloat(match[1]);
        var transfoY = parseFloat(match[2]);
        const zoom = parseFloat(match[3]);
     
        // Set the transform attribute with the updated rotation
        nodeGroup.setAttribute(
            'transform',
            `translate(${transfoX}, ${transfoY}) scale(${zoom}) rotate(${rotationAngle.toFixed(2)}) `
        );

        // Continue the animation until 360 degrees is completed
        if (elapsedTime < duration) {
            requestAnimationFrame((timestamp) => rotate(timestamp));
        } else {         
            nodeGroup.setAttribute(
                'transform',
                `translate(${transfoX}, ${transfoY}) scale(${zoom})`
            );            
        }
    }

     // Start the first flip animation
     requestAnimationFrame((timestamp) => rotate(timestamp, 1));
}


//////////////////// MULTI USERS ////////////////////

function multiUsers() {
    
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token'); 
    const socket = new WebSocket(`ws://localhost:8000/ws/?token=${token}`);

    // Listen for socket events
    socket.onopen = function() {
        console.log('WebSocket is connected.');
    };

    socket.onmessage = function(event) {
        const data = JSON.parse(event.data);
        if (data.mouse_position) {
            updateUserMousePosition({
                ID: data.userID,
                x: data.mouse_position.x,
                y: data.mouse_position.y,
                userName: data.userName
            });  
        }
        // Check if a user has disconnected
        if (data.userDisconnected) {
            removeUserCursor(data.userDisconnected);
        }
    };

    socket.onclose = function() {
        console.log('WebSocket is closed now.');
    };

    // Function to remove a user's cursor when they disconnect
    function removeUserCursor(userID) {
        if (userMousePositions[userID]) {
            document.body.removeChild(userMousePositions[userID]);
            delete userMousePositions[userID];
        }
    }

    // Capture mouse position and send it to the server
    document.addEventListener('mousemove', (event) => {
        const mousePosition = {
            x: event.clientX/currentZoom + (parseFloat(root.getAttribute('x'))/currentZoom ),
            y: event.clientY/currentZoom - (parseFloat(root.getAttribute('y'))/currentZoom),
        };

        // Send mouse position to server
        socket.send(JSON.stringify({
            userID: userID,
            userName: userName,
            mouse_position: mousePosition
        }));
    });

    // Function to update other users' mouse positions in UI
    const userMousePositions = {}; // Store positions for different users

    function updateUserMousePosition(position) {
        const { ID, x, y, userName } = position; 
        // Skip updating if the userID matches client's one
        if (ID === userID || !isLoggedIn) return;
        
        if (!userMousePositions[ID] && ID !== 0) {
            // Create a new element for this user's mouse position
            const userCursor = document.createElement('div');
            userCursor.className = 'user-cursor';
            userCursor.style.position = 'absolute';
            userCursor.style.backgroundColor = getRandomNeonColor();
            
            document.body.appendChild(userCursor);
            userMousePositions[ID] = userCursor;

            const tooltip = document.createElement('span');
            tooltip.textContent = userName || `User ${ID}`;
            tooltip.style.color = userCursor.style.backgroundColor; 
            tooltip.className = 'user-tooltip';
            tooltip.style.display = 'none'; 
            userCursor.appendChild(tooltip);

            userCursor.addEventListener('mouseover', () => {
                tooltip.style.display = 'block'; 
            });
            userCursor.addEventListener('mouseout', () => {
                tooltip.style.display = 'none'; 
            });
        }    
        // Update the cursor's position
        userMousePositions[ID].style.left = `${x*currentZoom - parseFloat(root.getAttribute('x'))*currentZoom}px`;
        userMousePositions[ID].style.top = `${y*currentZoom + parseFloat(root.getAttribute('y'))*currentZoom}px`;
    }
}

function getRandomNeonColor() {
    // Array of neon colors in hex format
    const neonColors = [
        '#39FF14', // Neon Green
        '#FF1493', // Neon Pink
        '#14B3FF', // Neon Blue
        '#FFFF14', // Neon Yellow
        '#FF6100', // Neon Orange
        '#FF00FF', // Neon Fuchsia
        '#0FFF0F', // Neon Lime
        '#0D00FF', // Neon Vivid Blue
        '#F0FF14', // Neon Bright Yellow
        '#FF0000', // Neon Red
        '#18FFFF', // Neon Cyan
        '#FF6EC7', // Neon Light Pink
        '#FFD700', // Neon Gold
        '#8AFF00', // Neon Electric Lime
        '#FF4F00', // Neon Red-Orange
        '#FF8C00', // Neon Dark Orange
        '#7CFC00', // Neon Lawn Green
        '#32CD32', // Neon Lime Green
        '#00FF7F', // Neon Spring Green
        '#FF4500', // Neon Orange-Red
        '#DC143C', // Neon Crimson
        '#00FA9A', // Neon Medium Spring Green
        '#00CED1'  // Neon Dark Turquoise
    ];
    
    // Select a random color from the neonColors array
    const randomIndex = Math.floor(Math.random() * neonColors.length);
    return neonColors[randomIndex];
}



