// Get the interactive area
let layer = document.getElementById('interactive-area');
layer.classList.add('universe');
let guestUser = false;
let admin = false;
let displayTutorial = false;
let nodeCounter = 0;
let linkCounter = 0; 
let layerCounter;
let layerNumber;
let layers = [];
let selectedLayer;
let currentNode = null;
let currentLink = null;
let quantum;
let seeNotification;

let selectedNodes = [];
let selectedLinks = [];
let selectedTemplates = [];

// Create an SVG element
const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svg.setAttribute('width', '100vw');
svg.setAttribute('height', '100vh');
svg.setAttribute('id','svg');

// Add the SVG element to the interactive area
layer.appendChild(svg);

const universe = document.createElementNS('http://www.w3.org/2000/svg', 'g');
universe.setAttribute('transform', `translate(${0},${0}) scale(${1})`);
universe.setAttribute('id','universe');
universe.style.perspective = '800px';
svg.appendChild(universe);
const tutorial = document.getElementById('tutorial');

currentZoom = 1;
   
let root = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
root.setAttribute('x', 0);
root.setAttribute('y', 0);
root.setAttribute('cx', window.innerWidth/2);
root.setAttribute('cy', window.innerHeight/2);
root.setAttribute('drag-transform', `translate(${0},${0})`);
root.setAttribute('transform', `translate(${0},${0})`);
root.setAttribute('r', 2.7);
root.setAttribute('fill', 'transparent')
svg.appendChild(root);

svg.addEventListener('dblclick', (event) => {
    if(currentNode) { return;};
    event.preventDefault();
    var node;
    if (event.target.tagName.toLowerCase() === 'svg' && !selectionArea(event, currentNode)) {
        
        if(displayTutorial) {
            node = createNode(event.clientX,event.clientY);
            focusNode(node,false);
            if (nodeCounter === 1){
                tutoPhase+=1;
            }
            tuto(node);
        } else if (isLoggedIn){
            if (nodeCounter !== 0){
                color = getRandomColor();
            }            
            node = createNode(event.clientX,event.clientY);
            focusNode(node,false);
            CurrentNode(node);
        }       
    }      
});

const centerX = window.innerWidth/2;
const centerY = window.innerHeight/2;
let zoomX = 0;
let zoomY = 0;
let originX = 0;
let originY = 0;
let isDragging = false;
let isTyping = false;
let isSizing = false;
let overlay = false;
let internalLink = false;
let preview = false;
let loadimage = false;
let cancelList = [];
let doubleCancel = [];
let cancelIndex = 0;
let colorContext = '';
let color = "#33FF99";

semanticsearch.blur();

//////////////////// NODE CREATION ////////////////////

function createNode(x,y,id) {
    var nodeID = id;
    var count;
    if (!id) {
        nodeCounter++; 
        count = nodeCounter;
        nodeID = `N-${nodeCounter}`;
    } else {
        count = id.match(/\d+/)[0], 10;
    }
    const nodeSize = 20 ;  
    let transfoX = ((x - centerX) + parseFloat(root.getAttribute('x')))/currentZoom;
    let transfoY = ((y - centerY) - parseFloat(root.getAttribute('y')))/currentZoom;
           
    const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodeGroup.setAttribute('class', 'node-group');
    nodeGroup.setAttribute('id', nodeID);
    nodeGroup.setAttribute('type', 'text');
    nodeGroup.setAttribute('x', transfoX);
    nodeGroup.setAttribute('y', -transfoY);
    nodeGroup.setAttribute('layer',layerNumber); 
    nodeGroup.setAttribute('links', JSON.stringify([]));
    nodeGroup.setAttribute('siblings', JSON.stringify([]));
    nodeGroup.setAttribute('quantum', JSON.stringify([]));
    nodeGroup.setAttribute('textcontent', '');
    nodeGroup.setAttribute('imagecontent', '');
    nodeGroup.setAttribute('videolink','');
    nodeGroup.setAttribute('videocontent','Nod-Z');
    nodeGroup.setAttribute('canvascontent',JSON.stringify([]));
    nodeGroup.setAttribute('file',nodeID);
    nodeGroup.setAttribute('filename','');
    nodeGroup.setAttribute('color',color);
    nodeGroup.setAttribute('shape', 'circle');   
    nodeGroup.setAttribute('likes', 0);   
    nodeGroup.setAttribute('lock', '0'); 
    nodeGroup.setAttribute('notification', '');
    nodeGroup.setAttribute('transform', `translate(${Math.round(transfoX)},${Math.round(transfoY)}) scale(${1})`);
    nodeGroup.style.stroke = color;
        
    const hitbox = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hitbox.setAttribute('class', 'hitbox');
    hitbox.setAttribute('cx', centerX);
    hitbox.setAttribute('cy', centerY);
    hitbox.setAttribute('r', nodeSize);

    // Create the square that fits perfectly over the circle
    const square = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    // square.setAttribute('class', 'square');
    square.setAttribute('x', centerX - nodeSize);
    square.setAttribute('y', centerY - nodeSize);
    square.setAttribute('width', 2 * nodeSize); // Width equals the diameter of the circle
    square.setAttribute('height', 2 * nodeSize); // Height equals the diameter of the circle
    square.style.stroke = color;     

    hitbox.addEventListener('mouseover', function (){
        if(!isSizing){
            CurrentNode(nodeGroup);           
        }       
        
    });

    square.addEventListener('mouseover', function (){
        if(!isSizing){
            CurrentNode(nodeGroup);
        }  
    });

    /////////////// Buttons for node type /////////////////////
    
    const nodetypedropdown = document.createElement('select');
    nodetypedropdown.id = `nodetypedropdown-${count}`;
    nodetypedropdown.style.appearance = 'none';
    if(dark) {
        nodetypedropdown.classList.add('select-dropdown');
    } else {
        nodetypedropdown.classList.add('selectlight');
    }

    nodetypedropdown.style.pointerEvents = 'auto'; 
  
    const options = [
        { text: 'Text' },
        { text: 'Image' },
        { text: 'Video' },
        { text: 'File' },
        { text: 'Canvas' },
      ];
      
      options.forEach(option => {
        // Create an option element
        const optionElement = document.createElement('option');
        optionElement.value = option.text.toLowerCase(); // Set option value to lowercase         
        optionElement.appendChild(document.createTextNode(option.text));       
   
        // Append the option to the dropdown
        nodetypedropdown.appendChild(optionElement);
      });
    // Add event listener to the dropdown 

    nodetypedropdown.addEventListener('mouseover', function() {
        if (displayTutorial){
            const node0 = document.getElementById('node0')
            var tutobox_txt = node0.innerHTML;
            node0.innerHTML = 'Nod: <strong>Here you can switch my content type.</strong> I keep in mind all my potential states, meaning that if you choose <strong>Image</strong> I remember the <strong>text input</strong> that can be used as <strong>Metadata for classification and ease of search</strong>';
            nodetypedropdown.addEventListener('mouseout', function() {
                node0.innerHTML=tutobox_txt;
            }, { once: true });
        }
    });
    nodetypedropdown.addEventListener('change', function(event) {
        if(displayTutorial) {
            event.stopPropagation();
            return;
        }
        const selectedOption = event.target.value;
        img.style.display = 'none';
        fileContainer.style.display = 'none';
        fileGroup.style.display = 'none';
        input.style.display = 'none';
        canvas.style.display = 'none'; 
        videoContainer.style.display = 'none';
        // foreignObject.style.background = 'transparent';
        hideParams(nodeGroup);

    // Perform actions based on the selected option
        switch (selectedOption) {
        case 'text':
            nodeGroup.setAttribute('type', 'text');
            input.style.display = 'block';
    
            var textContent = input.textContent;            
            input.style.height = 20+'px';
        
            var maxFontSize = getMaxFontSize(input);     
            input.style.lineHeight = maxFontSize+'px';          

            if (textContent ==='' || input.scrollHeight < 120){                
                input.style.height = 'auto';
                nodeSizing(nodeGroup,120,120);                               
            } else { 
                input.style.height = 'auto';            
                var dim = (input.scrollHeight + parseInt(foreignObject.getBoundingClientRect().width)) / 2;
                nodeSizing(nodeGroup,dim,dim);
            } 
            prevtextlength = textContent.length;
            if(nodeGroup.getAttribute('lock') === '0') { 
                input.focus();
            } 
            break;
        case 'image':
            // console.log('Image option selected');
            nodeGroup.setAttribute('type', 'image');
            img.style.display = 'block';
            var expectedSrc = '/static/img/newimg';
            if (img.src.includes(expectedSrc)) {           
                foreignObject.setAttribute('width', '30px');
                foreignObject.setAttribute('height','30px');     
                foreignObject.setAttribute('x', centerX - parseFloat(foreignObject.getAttribute('width'))/2);
                foreignObject.setAttribute('y', centerY - parseFloat(foreignObject.getAttribute('height'))/2);             
            } 
            var newimg = document.createElement('input');
            newimg.type = 'file';  
            
            if (loadimage || nodeGroup.getAttribute('imagecontent') === '') {         
                newimg.click();
                loadimage = false;
            }           
            
            newimg.addEventListener('change', function () {
                // Get the selected file
                var file = newimg.files[0];
            
                if (file) {
                    // Check if the selected file is an image
                    if (file.type.startsWith('image/')) {
                        // Create a FileReader to read the contents of the file
                        var reader = new FileReader();
                        reader.onload = function (e) {
        
                            img.onload = function() { 
                                nodeSizing(nodeGroup,250,250);
                            };
                            // Set the image source to the data URL of the selected file
                            img.src = e.target.result;
                            nodeGroup.setAttribute('imagecontent',img.src);
                            // if(nodeGroup.getAttribute('shape') === 'circle'){
                            //     // nodeGroup.children[1].stroke = nodeGroup.getAttribute('color');
                            //     nodeSelection(nodeGroup);
                            //     nodeUnselection(nodeGroup);
                            // }
                        };;
        
                        // Read the contents of the file as a data URL
                        reader.readAsDataURL(file);
        
                    } else {
                        let popup = document.createElement('div');
                        popup.className = 'popup'; 
                        const message = document.createElement('div');
                        message.className = 'smallmessage';                         
                        message.textContent = `Please select a valid image file\n(PNG, JPG, GIF, or SVG)`;
                        message.style.whiteSpace = 'pre-line';                      
                        popup.appendChild(message);
                        document.body.appendChild(popup);
                        setTimeout(function() {
                            closePopup(); 
                        }, 2000);
                    
                        function closePopup() {
                            document.body.removeChild(popup);
                            popup = null;
                        }
                    }            
                } 
            });            
            break;
        case 'video':
            // console.log('Video option selected');
            nodeGroup.setAttribute('type', 'video');
            nodeSizing(nodeGroup,200,200); 
            video.style.display = 'block';
            videoinput.style.display = 'block';
            videoContainer.style.display = 'block';
            foreignObject.style.background = 'black';
            const match = nodeGroup.id.match(/\d+/);
            const number = match ? parseInt(match[0]) : null;  

            const playerElement = document.getElementById(`videoplayer-${number}`);
    
            if (!playerElement.querySelector('iframe')) {
                loadYouTubeVideo(number);
            }                  
                        
            break;
        case 'file':
            // console.log('Document option selected');
            nodeGroup.setAttribute('type', 'file');
            fileContainer.style.display = 'block';
            fileGroup.style.display = 'block';   
            fileGroup.setAttribute('visibility', 'visible');     
            
            if (nodeGroup.getAttribute('filename') === '') {         
                fileButton1input.click();
            }    

            break;
        case 'canvas':
            // console.log('Canvas option selected');
            nodeGroup.setAttribute('type', 'canvas');
            canvasStyleGroup.setAttribute('visibility','visible');
            canvas.style.display = 'block'; 
            var canvasID = canvas.getAttribute('id');
            const customCursor = document.getElementById('customCursor');
            let drawingData = [];
            var ctx = canvas.getContext('2d');
            nodeSizing(nodeGroup,150,150);
    
            if (dark) {           
                ctx.strokeStyle = 'white';
            } else {
                ctx.strokeStyle = 'black';
            }

            canvas.addEventListener('mousedown', function(event) {
                event.preventDefault();
                hideParams(nodeGroup);    
                if(nodeGroup.getAttribute('lock') === '1') { 
                    return;
                }         
                canvasStyleGroup.style.display = 'block';
        
                var drawingDataString = nodeGroup.getAttribute('canvascontent');
                // Parse the string back into an array of objects           
                try {
                    drawingData = drawingDataString ? JSON.parse(drawingDataString) : [];
                } catch (error) {
                    // console.error('Error parsing JSON:', error);
                    drawingData = []; // Default to empty object if parsing fails
                }

                if (!isErasing){
                    drawingData = startDrawing(event, canvasID, canvasUndoCounter,drawingData,preventDrawing);
                    canvasUndoCounter = 0;                 
                    nodeGroup.children[1].classList = 'hitbox';
                }
            });
            
            canvas.addEventListener('mousemove', function(event) {
                if(nodeGroup.getAttribute('lock') === '1') { 
                    canvas.style.cursor = 'pointer';
                    return;
                }
                drawingData = draw(event, canvasID, drawingData);                   
                customCursor.style.display = 'block';
                canvas.style.cursor = 'none';
                if(isErasing){
                    customCursor.style.backgroundImage = 'url("/static/img/eraser-cursor.svg")';
                    customCursor.style.left = `${event.clientX - (customCursor.offsetWidth / 2)}px`;
                    customCursor.style.top = `${event.clientY - (customCursor.offsetHeight / 2)}px`;

                } else {
                    customCursor.style.backgroundImage = 'url("/static/img/pen-cursor.svg")';
                    customCursor.style.left = `${event.clientX - 0*(customCursor.offsetWidth / 2)}px`;
                    customCursor.style.top = `${event.clientY - (customCursor.offsetHeight)}px`;
                }
                
            });
            canvas.addEventListener('mouseup', function(event) {
                stopDrawing(nodeGroup, drawingData);
                preventDrawing = false;
            });
            canvas.addEventListener('mouseout', function() {
                event.preventDefault;
                customCursor.style.display = 'none';
            });
        
            break;
        
        default:
            // Handle default case
            'text';
            break;
        }
    });

    const typeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const typeButton = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    var typeButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    typeButtonfo.setAttribute('class', 'styledropdown');
    typeButtonfo.style.pointerEvents = 'none'; 
    typeButtonfo.appendChild(nodetypedropdown);
    typeGroup.appendChild(typeButtonfo);
    typeGroup.appendChild(typeButton);
    
    var colorButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    colorButtonfo.setAttribute('class', 'stylebutton'); 
    const colorButtonimg = document.createElement('img');
    colorButtonimg.id = `colorButtonimg-${count}`;
    if (dark) {
        colorButtonimg.setAttribute('src', '/static/img/colorpicking.svg');
    } else {
        colorButtonimg.setAttribute('src', '/static/img/colorpicking-light.svg');
    }    
    colorButtonimg.style.width = '60%';
    colorButtonimg.style.height = '60%';
    colorButtonimg.style.padding = '5px';
    colorButtonimg.setAttribute('class', 'stylebuttonimg'); 
    colorButtonfo.appendChild(colorButtonimg);
    typeGroup.appendChild(colorButtonfo);
    

    const sizeButton = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    sizeButton.setAttribute('class', 'stylebutton');
    sizeButton.style.stroke ='transparent';
    sizeButton.style.pointerEvents = 'none';
    var sizeButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    sizeButtonfo.setAttribute('class', 'stylebutton');
    sizeButtonfo.style.pointerEvents = 'auto';
    sizeButton.style.width = 25 + 'px';
    sizeButton.style.height = 25 + 'px';   
    const sizeButtonimg = document.createElement('div');
    const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="25" height="25" viewBox="0 0 800 800" version="1.1" id="Layer_1" viewBox="0 0 511.999 511.999" xml:space="preserve" transform="matrix(-1, 0, 0, 1, 0, 0)">
        <path style="fill:#f3ee58;" d="M3.92,243.079c-0.225,0.334-0.419,0.681-0.622,1.022c-0.183,0.309-0.377,0.611-0.549,0.929  c-0.188,0.352-0.348,0.714-0.517,1.071c-0.155,0.329-0.32,0.653-0.461,0.991c-0.144,0.351-0.261,0.709-0.388,1.064  c-0.13,0.36-0.268,0.715-0.38,1.083c-0.107,0.36-0.188,0.725-0.281,1.088c-0.093,0.372-0.197,0.742-0.273,1.12  c-0.085,0.424-0.135,0.85-0.194,1.277c-0.047,0.326-0.109,0.645-0.143,0.974c-0.15,1.53-0.15,3.07,0,4.6  c0.033,0.329,0.095,0.649,0.143,0.974c0.059,0.427,0.109,0.853,0.194,1.277c0.076,0.38,0.18,0.748,0.273,1.12  c0.093,0.363,0.172,0.728,0.281,1.088c0.112,0.368,0.25,0.723,0.38,1.083c0.127,0.355,0.244,0.714,0.388,1.064  c0.141,0.338,0.306,0.663,0.461,0.991c0.169,0.358,0.329,0.72,0.517,1.071c0.171,0.318,0.365,0.619,0.549,0.929  c0.205,0.343,0.399,0.689,0.622,1.022c0.23,0.346,0.489,0.673,0.74,1.005c0.205,0.273,0.394,0.554,0.614,0.821  c0.487,0.594,1.004,1.168,1.547,1.711l116.36,116.36c4.544,4.544,10.501,6.817,16.456,6.817c5.956,0,11.913-2.271,16.456-6.817  c9.089-9.087,9.089-23.824,0-32.913l-76.636-76.636h353.088l-76.636,76.636c-9.089,9.087-9.089,23.824,0,32.913  c4.544,4.544,10.501,6.817,16.456,6.817s11.913-2.271,16.456-6.817l116.36-116.36c0.545-0.543,1.06-1.116,1.547-1.711  c0.22-0.267,0.41-0.548,0.613-0.821c0.251-0.332,0.509-0.659,0.74-1.005c0.225-0.334,0.419-0.681,0.622-1.022  c0.183-0.309,0.377-0.611,0.549-0.929c0.188-0.352,0.348-0.714,0.517-1.071c0.155-0.329,0.32-0.653,0.461-0.991  c0.144-0.351,0.261-0.709,0.388-1.064c0.13-0.36,0.268-0.715,0.38-1.083c0.107-0.36,0.188-0.725,0.281-1.088  c0.093-0.372,0.197-0.742,0.273-1.12c0.085-0.424,0.135-0.85,0.194-1.277c0.047-0.326,0.109-0.645,0.143-0.974  c0.15-1.53,0.15-3.07,0-4.6c-0.034-0.329-0.096-0.649-0.143-0.974c-0.059-0.427-0.109-0.853-0.194-1.277  c-0.076-0.38-0.18-0.748-0.273-1.12c-0.093-0.363-0.172-0.728-0.281-1.088c-0.112-0.368-0.25-0.723-0.38-1.083  c-0.127-0.355-0.244-0.714-0.388-1.064c-0.141-0.338-0.306-0.663-0.461-0.991c-0.169-0.358-0.329-0.72-0.517-1.071  c-0.171-0.318-0.365-0.619-0.549-0.929c-0.205-0.343-0.399-0.689-0.622-1.022c-0.231-0.346-0.489-0.673-0.74-1.005  c-0.205-0.273-0.394-0.554-0.613-0.821c-0.489-0.594-1.004-1.168-1.547-1.711l-116.36-116.36c-9.087-9.089-23.824-9.089-32.913,0  c-9.089,9.087-9.089,23.824,0,32.913l76.636,76.636H79.457l76.636-76.636c9.089-9.087,9.089-23.824,0-32.913  c-9.087-9.089-23.824-9.089-32.913,0L6.82,239.541c-0.545,0.543-1.06,1.116-1.547,1.711c-0.22,0.267-0.41,0.548-0.614,0.821  C4.408,242.407,4.15,242.733,3.92,243.079z"/>
    </svg>
    `;
    sizeButtonimg.innerHTML = svgMarkup;
    sizeButtonimg.style.width = '100%';
    sizeButtonimg.style.height = '100%';
    const pathElement = sizeButtonimg.querySelector('path');
    pathElement.style.fill = color;
    sizeButtonfo.appendChild(sizeButtonimg);
    typeGroup.appendChild(sizeButtonfo);
    typeGroup.appendChild(sizeButton);

    var shapeButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    shapeButtonfo.setAttribute('class', 'stylebutton'); 
    const shapeButtonimg = document.createElement('img');
    // shapeButtonimg.id = `shapeButtonimg-${count}`;
    if (dark) {
        shapeButtonimg.setAttribute('src', '/static/img/circle.svg');
    } else {
        shapeButtonimg.setAttribute('src', '/static/img/circle-light.svg');
    }
    shapeButtonimg.setAttribute('class', 'stylebuttonimg'); 
    shapeButtonfo.appendChild(shapeButtonimg);
    typeGroup.appendChild(shapeButtonfo);

    var calendarButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    calendarButtonfo.setAttribute('class', 'stylebutton'); 
    const calendarButtonimg = document.createElement('img');
    // calendarButtonimg.id = `calendarButtonimg-${count}`;
    if (dark) {
        calendarButtonimg.setAttribute('src', '/static/img/calendar.svg');
    } else {
        calendarButtonimg.setAttribute('src', '/static/img/calendar-light.svg');
    }
    calendarButtonimg.style.width = '60%';
    calendarButtonimg.style.height = '60%';
    calendarButtonimg.style.padding = '5px';
    calendarButtonimg.setAttribute('class', 'stylebuttonimg'); 
    calendarButtonfo.appendChild(calendarButtonimg);
    typeGroup.appendChild(calendarButtonfo);    

    var lockButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    lockButtonfo.setAttribute('class', 'stylebutton'); 
    const lockButtonimg = document.createElement('img');
    // lockButtonimg.id = `lockButtonimg-${count}`;
    if (dark) {
        lockButtonimg.setAttribute('src', '/static/img/unlock.svg');
    } else {
        lockButtonimg.setAttribute('src', '/static/img/unlock-light.svg');
    }
    lockButtonimg.style.width = '70%';
    lockButtonimg.style.height = '50%';
    lockButtonimg.setAttribute('class', 'stylebuttonimg'); 
    lockButtonfo.appendChild(lockButtonimg);
    typeGroup.appendChild(lockButtonfo);

    var layerButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    layerButtonfo.setAttribute('class', 'stylebutton'); 
    const layerButtonimg = document.createElement('img');
    // layerButtonimg.id = `layerButtonimg-${count}`;
    if (dark) {
        layerButtonimg.setAttribute('src', '/static/img/layer.svg');
    } else {
        layerButtonimg.setAttribute('src', '/static/img/layer-light.svg');
    }
    layerButtonimg.setAttribute('class', 'stylebuttonimg');
    layerButtonfo.appendChild(layerButtonimg);
    typeGroup.appendChild(layerButtonfo);

    /////////////// NODE FUNCTIONS /////////////////////

    var foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');  
    
    /////////////// TEXT /////////////////////

    var input = document.createElement('span');     
    input.setAttribute('class', 'node-text-input');
    input.setAttribute('contenteditable', 'true'); 
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('font-size','4')
    foreignObject.appendChild(input);
    
    const styleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    var boldButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    boldButtonfo.setAttribute('class', 'stylebutton');
    const boldButtondiv = document.createElement('div');
    boldButtondiv.setAttribute('class', 'stylebuttoncontainer');    
    const boldButtonimg = document.createElement('img');
    if (dark) {
        boldButtonimg.setAttribute('src', '/static/img/bold.svg');
    } else {
        boldButtonimg.setAttribute('src', '/static/img/bold-light.svg');
    }
    boldButtonimg.setAttribute('class', 'stylebuttonimg');
    boldButtonimg.id = `boldButtonimg-${count}`;
    boldButtonimg.style.width = '50%';
    boldButtonimg.style.height = '50%';
    boldButtondiv.appendChild(boldButtonimg);
    boldButtonfo.appendChild(boldButtondiv);
    styleGroup.appendChild(boldButtonfo);

    var italicButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    italicButtonfo.setAttribute('class', 'stylebutton');
    const italicButtondiv = document.createElement('div');
    italicButtondiv.setAttribute('class', 'stylebuttoncontainer');    
    const italicButtonimg = document.createElement('img');
    italicButtonimg.id = `italicButtonimg-${count}`;
    if (dark) {
        italicButtonimg.setAttribute('src', '/static/img/italic.svg');
    } else {
        italicButtonimg.setAttribute('src', '/static/img/italic-light.svg');
    }
    italicButtonimg.setAttribute('class', 'stylebuttonimg');
    italicButtonimg.style.width = '60%';
    italicButtonimg.style.height = '60%';
    italicButtondiv.appendChild(italicButtonimg);
    italicButtonfo.appendChild(italicButtondiv);
    styleGroup.appendChild(italicButtonfo);

    var underlineButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    underlineButtonfo.setAttribute('class', 'stylebutton');
    const underlineButtondiv = document.createElement('div');
    underlineButtondiv.setAttribute('class', 'stylebuttoncontainer');    
    const underlineButtonimg = document.createElement('img');
    underlineButtonimg.id = `underlineButtonimg-${count}`;
    if (dark) {
        underlineButtonimg.setAttribute('src', '/static/img/underline.svg');
    } else {
        underlineButtonimg.setAttribute('src', '/static/img/underline-light.svg');
    }
    underlineButtonimg.setAttribute('class', 'stylebuttonimg');
    underlineButtondiv.appendChild(underlineButtonimg);
    underlineButtonfo.appendChild(underlineButtondiv);
    styleGroup.appendChild(underlineButtonfo);

    const fontdropdown = document.createElement('select');
    fontdropdown.id = `fontdropdown-${count}`;
    if(dark) {
        fontdropdown.classList.add('select-dropdown');
    } else {
        fontdropdown.classList.add('selectlight');
    }
    
    fontdropdown.style.width = 18+'px';
    fontdropdown.style.height = 18+'px';
    fontdropdown.style.textAlign = 'left';
    
    const fonts = [
        { value: 1, text: 'XS', fontSize: '10px'},
        { value: 2, text: 'S', fontSize: '10px'},
        { value: 4, text: 'M', fontSize: '10px'},
        { value: 6, text: 'L', fontSize: '10px'},
        { value: 7, text: 'XL', fontSize: '10px'},
    ];
        
    fonts.forEach(option => {
        // Create an option element
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.style.fontSize = option.fontSize;
        optionElement.appendChild(document.createTextNode(option.text));
        // Append the option to the dropdown
        fontdropdown.appendChild(optionElement);
    });
    fontdropdown.value = '';

    var fontSizeButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fontSizeButtonfo.setAttribute('class', 'stylebutton');  
    fontSizeButtonfo.style.width = 25+'px';
    fontSizeButtonfo.style.height = 25+'px';
    fontSizeButtonfo.style.zIndex = 100;
    fontSizeButtonfo.appendChild(fontdropdown);  
    styleGroup.appendChild(fontSizeButtonfo);


    var textColorButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    textColorButtonfo.setAttribute('class', 'stylebutton');   
    const textColorButtonimg = document.createElement('img');
    textColorButtonimg.setAttribute('class', 'stylebuttonimg');
    textColorButtonimg.style.width = '70%';
    textColorButtonimg.style.height = '70%';
    textColorButtonimg.style.margin = '5px';
    textColorButtonimg.id = `textColorButtonimg-${count}`;
    if (dark) {
        textColorButtonimg.setAttribute('src', '/static/img/colorpicking.svg');
    } else {
        textColorButtonimg.setAttribute('src', '/static/img/colorpicking-light.svg');
    }
    textColorButtonfo.appendChild(textColorButtonimg);
    styleGroup.appendChild(textColorButtonfo);

    var smileyButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    smileyButtonfo.setAttribute('class', 'stylebutton');
    const smileyButtondiv = document.createElement('div');
    smileyButtondiv.setAttribute('class', 'stylebuttoncontainer');    
    const smileyButtonimg = document.createElement('img');
    smileyButtonimg.id = `smileyButtonimg-${count}`;
    if (dark) {
        smileyButtonimg.setAttribute('src', '/static/img/smiley.svg');
    } else {
        smileyButtonimg.setAttribute('src', '/static/img/smiley-light.svg');
    }
    smileyButtonimg.setAttribute('class', 'stylebuttonimg');
    smileyButtondiv.appendChild(smileyButtonimg);
    smileyButtonfo.appendChild(smileyButtondiv);
    styleGroup.appendChild(smileyButtonfo);

    
    /////////////// IMAGE /////////////////////
    
    var img = document.createElement("img");
    img.id = `img-${count}`;
    if (dark) {
        img.setAttribute('src', '/static/img/newimg.svg');
    } else {
        img.setAttribute('src', '/static/img/newimg-light.svg');
    }
    img.setAttribute("width", "100%");
    img.setAttribute("height", "100%");
    // img.style.cursor = 'pointer';
    foreignObject.appendChild(img);

    /////////////// FILE /////////////////////

    var fileContainer = document.createElement('div');
    fileContainer.id = `filecontainer-${count}`;
    fileContainer.className = 'filecontainer';
    
    // Create iframe
    var filePreview = document.createElement('iframe');
    filePreview.id = `filePreview-${count}`;
    filePreview.className = 'filepreview';
    filePreview.style.display = 'none';
    fileContainer.appendChild(filePreview);
 
    // Create spinner
    var spinner = document.createElement('div');
    spinner.className = 'waitingspinner';
    spinner.id = 'loadingIndicator';
    spinner.style.display = 'none';   
    fileContainer.appendChild(spinner);

    const fileGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    // Create button for file input
    var fileButton1fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fileButton1fo.setAttribute('class', 'stylebutton');
    const fileButton1div = document.createElement('div');
    fileButton1div.setAttribute('class', 'stylebuttoncontainer');  
    fileButton1div.style.zIndex = '100';  
    const fileButton1input = document.createElement('input');
    fileButton1input.type = 'file';
    fileButton1input.id = `fileButton1input-${count}`;
    var uploadUrl = 'upload-file/';
    fileButton1input.setAttribute('hx-post', uploadUrl);
    fileButton1input.style.opacity = 0;
    fileButton1input.style.zIndex = '200';
    fileButton1input.style.position = 'absolute'; 
    fileButton1input.style.pointerEvents = 'none'; 
    fileButton1div.appendChild(fileButton1input);
    const fileButton1img = document.createElement('img');
    fileButton1img.id = `fileButton1img-${count}`;
    if (dark) {
        fileButton1img.setAttribute('src', '/static/img/upload.svg');
    } else {
        fileButton1img.setAttribute('src', '/static/img/upload-light.svg');
    } 
    fileButton1img.setAttribute('class', 'stylebuttonimg');
    fileButton1div.appendChild(fileButton1img);
    fileButton1fo.appendChild(fileButton1div);
    fileGroup.appendChild(fileButton1fo);

    // Create download file button
    var fileButton2fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fileButton2fo.setAttribute('class', 'stylebutton');
    const fileButton2div = document.createElement('div');
    fileButton2div.id = `fileButton2div-${count}`;
    fileButton2div.setAttribute('class', 'stylebuttoncontainer');    
    const fileButton2img = document.createElement('img');
    fileButton2img.id = `fileButton2img-${count}`;
    if (dark) {
        fileButton2img.setAttribute('src', '/static/img/download.svg');
    } else {
        fileButton2img.setAttribute('src', '/static/img/download-light.svg');
    } 
    fileButton2img.setAttribute('class', 'stylebuttonimg');
    fileButton2div.appendChild(fileButton2img);
    fileButton2fo.appendChild(fileButton2div);
    fileGroup.appendChild(fileButton2fo);

    // FileName 
    var fileButton3fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fileButton3fo.style.height = '100px';
    fileButton3fo.style.width = '90%'
    
    var fileButton3div = document.createElement('div');
    fileButton3div.id = `fileButton3div-${count}`;
    fileButton3div.setAttribute('class', 'filenamecontainer');
    if (dark) {
        fileButton3div.setAttribute('class', 'filename');
    } else {
        fileButton3div.setAttribute('class', 'filename-light');
    }
    fileButton3div.textContent = '';
    fileButton3fo.appendChild(fileButton3div);
    fileGroup.appendChild(fileButton3fo);
    foreignObject.appendChild(fileContainer);

    /////////////// VIDEO /////////////////////
    
    var videoContainer = document.createElement("div");
    videoContainer.className = 'videocontainer';
    var video = document.createElement("div");
    video.style.width = '100%';
    video.style.height = '100%';
    const videoplayerID = `videoplayer-${count}`;
    video.setAttribute('id', videoplayerID);
  
    // Create the left button
    var leftButton = document.createElement("button");
    leftButton.innerHTML = '&lt;';
    leftButton.className = 'arrow-button search-button-left';
    leftButton.id = `leftButton-${count}`;

    leftButton.addEventListener('mouseover', function(event) {
        createTooltip (leftButton.id,'Previous video',event);
    });

    // Create the right button
    var rightButton = document.createElement("button");
    rightButton.innerHTML = '&gt;';
    rightButton.className = 'arrow-button search-button-right';
    rightButton.id = `rightButton-${count}`;

    rightButton.addEventListener('mouseover', function(event) {
        createTooltip (rightButton.id,'Next video',event);
    });

    // Create the input element for search
    var videoinput = document.createElement('input');
    videoinput.setAttribute('type', 'text');
    const videoinputID = `videoinput-${count}`;
    videoinput.setAttribute('id', videoinputID);
    videoinput.setAttribute('placeholder', 'Enter YouTube link for specific video / Keywords to create a personalized playlist');
    videoinput.setAttribute('autocomplete', 'off');
    videoinput.className = 'videoinput';

    scrollPlaceholder(videoinput,videoinput.getAttribute('placeholder'),80);


    videoinput.onmousedown = function() {
        isTyping = true;
    };

    videoinput.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
            // Prevent the default form submission behavior
            event.preventDefault();
            const match = nodeGroup.id.match(/\d+/);
            const number = match ? parseInt(match[0]) : null;            
            loadYouTubeVideo(number);               
        }
    });

    videoinput.addEventListener('input', function() {
        isTyping = true;
    });
    videoinput.addEventListener('blur', function() {
        isTyping = false;
    });
    videoinput.addEventListener('mouseover', function() {
        if(!this.disabled) {
            this.value = ''; 
        }
    });
    videoinput.addEventListener('mouseout', function() {
        if(!this.disabled) {
            this.value = nodeGroup.getAttribute('videolink'); 
        }        
    });


    leftButton.addEventListener('mousedown', function() {
        if (videoSearch.length !== 0) {
            if (videoIndex === 0) {
                videoIndex = videoSearch.length - 1;
            } else {
                videoIndex -= 1;
            }
            
            videoinput.value = videoSearch[videoIndex];
            nodeGroup.setAttribute('videolink',videoSearch[videoIndex])
            const match = nodeGroup.id.match(/\d+/);
            const number = match ? parseInt(match[0]) : null;    
            if(intervalId === null)  {
                loadYouTubeVideo(number);  
            } 
        }   
    });

    rightButton.addEventListener('mousedown', function() {
        if (videoSearch.length !== 0) {
            if (videoIndex === videoSearch.length - 1) {
                videoIndex = 0;
            } else {
                videoIndex += 1;
            }
            
            videoinput.value = videoSearch[videoIndex];
            nodeGroup.setAttribute('videolink',videoSearch[videoIndex])
            const match = nodeGroup.id.match(/\d+/);
            const number = match ? parseInt(match[0]) : null;    
            if(intervalId === null)  {
                loadYouTubeVideo(number);  
            }
        }  
    });


    videoContainer.appendChild(video);
    videoContainer.appendChild(videoinput);
    videoContainer.appendChild(leftButton);
    videoContainer.appendChild(rightButton);
    
    foreignObject.appendChild(videoContainer);
    

    /////////////// CANVAS ///////////////////// 

    var canvas = document.createElement("canvas");
    const canvasID = `canvas-${count}`;
    canvas.setAttribute('id', canvasID);
    canvas.setAttribute("width", "750px");
    canvas.setAttribute("height", "750px");
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(255, 255, 255, 0)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const canvasStyleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    canvasStyleGroup.setAttribute('visibility','hidden');

    var canvasEraserButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    canvasEraserButtonfo.setAttribute('class', 'stylebutton');
    const canvasEraserButtondiv = document.createElement('div');
    canvasEraserButtondiv.setAttribute('class', 'stylebuttoncontainer');    
    const canvasEraserButtonimg = document.createElement('img');
    canvasEraserButtonimg.id = `canvasEraserButtonimg-${count}`;
    if (dark) {
        canvasEraserButtonimg.setAttribute('src', '/static/img/eraser.svg');
    } else {
        canvasEraserButtonimg.setAttribute('src', '/static/img/eraser-light.svg');
    } 
    canvasEraserButtonimg.setAttribute('class', 'stylebuttonimg');
    canvasEraserButtondiv.appendChild(canvasEraserButtonimg);
    canvasEraserButtonfo.appendChild(canvasEraserButtondiv);
    canvasStyleGroup.appendChild(canvasEraserButtonfo);

    var canvasRedoButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    canvasRedoButtonfo.setAttribute('class', 'stylebutton');
    const canvasRedoButtondiv = document.createElement('div');
    canvasRedoButtondiv.setAttribute('class', 'stylebuttoncontainer');    
    const canvasRedoButtonimg = document.createElement('img');
    canvasRedoButtonimg.id = `canvasRedoButtonimg-${count}`;
    if (dark) {
        canvasRedoButtonimg.setAttribute('src', '/static/img/redo.svg');
    } else {
        canvasRedoButtonimg.setAttribute('src', '/static/img/redo-light.svg');
    } 
    canvasRedoButtonimg.setAttribute('class', 'stylebuttonimg');
    canvasRedoButtondiv.appendChild(canvasRedoButtonimg);
    canvasRedoButtonfo.appendChild(canvasRedoButtondiv);
    canvasStyleGroup.appendChild(canvasRedoButtonfo);

    var canvasUndoButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    canvasUndoButtonfo.setAttribute('class', 'stylebutton');
    const canvasUndoButtondiv = document.createElement('div');
    canvasUndoButtondiv.setAttribute('class', 'stylebuttoncontainer');    
    const canvasUndoButtonimg = document.createElement('img');
    canvasUndoButtonimg.id = `canvasUndoButtonimg-${count}`;
    if (dark) {
        canvasUndoButtonimg.setAttribute('src', '/static/img/undo.svg');
    } else {
        canvasUndoButtonimg.setAttribute('src', '/static/img/undo-light.svg');
    } 
    canvasUndoButtonimg.setAttribute('class', 'stylebuttonimg');
    canvasUndoButtondiv.appendChild(canvasUndoButtonimg);
    canvasUndoButtonfo.appendChild(canvasUndoButtondiv);
    canvasStyleGroup.appendChild(canvasUndoButtonfo);

    var canvasClearButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    canvasClearButtonfo.setAttribute('class', 'stylebutton');
    const canvasClearButtondiv = document.createElement('div');
    canvasClearButtondiv.setAttribute('class', 'stylebuttoncontainer');    
    const canvasClearButtonimg = document.createElement('img');
    canvasClearButtonimg.id = `canvasClearButtonimg-${count}`;
    if (dark) {
        canvasClearButtonimg.setAttribute('src', '/static/img/eraseall.svg');
    } else {
        canvasClearButtonimg.setAttribute('src', '/static/img/eraseall-light.svg');
    } 
    canvasClearButtonimg.setAttribute('class', 'stylebuttonimg');
    canvasClearButtondiv.appendChild(canvasClearButtonimg);
    canvasClearButtonfo.appendChild(canvasClearButtondiv);
    canvasStyleGroup.appendChild(canvasClearButtonfo);

    var canvasLineButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    canvasLineButtonfo.setAttribute('class', 'stylebutton');
    const canvasLineButtondiv = document.createElement('div');
    canvasLineButtondiv.setAttribute('class', 'stylebuttoncontainer');    
    const canvasLineButtonimg = document.createElement('img');
    canvasLineButtonimg.id = `canvasLineButtonimg-${count}`;
    if (dark) {
        canvasLineButtonimg.setAttribute('src', '/static/img/line.svg');
    } else {
        canvasLineButtonimg.setAttribute('src', '/static/img/line-light.svg');
    } 
    canvasLineButtonimg.setAttribute('class', 'stylebuttonimg');
    canvasLineButtondiv.appendChild(canvasLineButtonimg);
    canvasLineButtonfo.appendChild(canvasLineButtondiv);
    canvasStyleGroup.appendChild(canvasLineButtonfo);

    var canvasCircleButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    canvasCircleButtonfo.setAttribute('class', 'stylebutton');
    const canvasCircleButtondiv = document.createElement('div');
    canvasCircleButtondiv.setAttribute('class', 'stylebuttoncontainer');    
    const canvasCircleButtonimg = document.createElement('img');
    canvasCircleButtonimg.id = `canvasButton9img-${count}`;
    if (dark) {
        canvasCircleButtonimg.setAttribute('src', '/static/img/circle.svg');
    } else {
        canvasCircleButtonimg.setAttribute('src', '/static/img/circle-light.svg');
    } 
    canvasCircleButtonimg.setAttribute('class', 'stylebuttonimg');
    canvasCircleButtondiv.appendChild(canvasCircleButtonimg);
    canvasCircleButtonfo.appendChild(canvasCircleButtondiv);
    canvasStyleGroup.appendChild(canvasCircleButtonfo);

    var canvassliderfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    canvassliderfo.setAttribute('width', '50');
    canvassliderfo.setAttribute('height', '20');

    const sliderdiv = document.createElement('div');
    sliderdiv.id = `sliderdiv-${count}`;
    sliderdiv.style.width = '80%';
    sliderdiv.style.height = '40%';
    sliderdiv.style.position = 'relative'

    const slider = document.createElement('input');
    slider.setAttribute('type', 'range');
    slider.setAttribute('min', '1');
    slider.setAttribute('max', '7');
    slider.setAttribute('value', '3'); // Set default value
    slider.setAttribute('class', 'range-input');
    slider.style.width = '80%'; 
    slider.style.height = '80%'; 

    // Append HTML elements to foreignObject
    sliderdiv.appendChild(slider);
    canvassliderfo.appendChild(sliderdiv);

    canvasStyleGroup.appendChild(canvassliderfo);


    slider.addEventListener("input", (event) => {
        const tempSliderValue = event.target.value;         
        const progress = (tempSliderValue / slider.max) * 100;        
        slider.style.background = `linear-gradient(to right, #b89af2 ${progress}%,  #6848A6 ${progress}%)`;
        var ctx = canvas.getContext('2d');                 
        ctx.lineWidth = tempSliderValue;    
    });


    var canvasColorButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    canvasColorButtonfo.setAttribute('class', 'stylebutton'); 
    canvasColorButtonfo.style.width = '25px';
    canvasColorButtonfo.style.height = '25px';
    const canvasColorButtonimg = document.createElement('img');
    canvasColorButtonimg.setAttribute('class', 'stylebuttonimg');
    canvasColorButtonimg.style.width = '15px';
    canvasColorButtonimg.style.height = '15px';
    canvasColorButtonimg.style.margin = '5px';
    canvasColorButtonimg.id = `canvasColorButtonimg-${count}`;
    if (dark) {
        canvasColorButtonimg.setAttribute('src', '/static/img/colorpicking.svg');
    } else {
        canvasColorButtonimg.setAttribute('src', '/static/img/colorpicking-light.svg');
    } 
    canvasColorButtonfo.appendChild(canvasColorButtonimg);
    canvasStyleGroup.appendChild(canvasColorButtonfo);

    // Color panel 
    let isErasing = false;

    foreignObject.appendChild(canvas);  

    /////////////// 4D EFFECTS /////////////////////

    var quantumButtonfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    quantumButtonfo.setAttribute('class', 'stylebutton'); 
    const quantumButtonimg = document.createElement('img');
    quantumButtonimg.setAttribute('src', '/static/img/portal.svg');
    quantumButtonimg.style.width = '100%';
    quantumButtonimg.style.height = '100%';
    quantumButtonfo.classList.add("portal");
    quantumButtonfo.appendChild(quantumButtonimg);
    quantumButtonfo.style.display = 'none';

    quantumButtonimg.addEventListener('mouseover', function(){
        currentNode = nodeGroup;
        document.addEventListener('keydown', keydownPortal);
    });
    quantumButtonimg.addEventListener('mouseout', function(){
        currentNode = null;
        document.removeEventListener('keydown', keydownPortal);
    });

    nodeGroup.appendChild(foreignObject);
    nodeGroup.appendChild(hitbox);
    nodeGroup.appendChild(square);
    nodeGroup.appendChild(quantumButtonfo);
    nodeGroup.appendChild(styleGroup);
    nodeGroup.appendChild(fileGroup);
    nodeGroup.appendChild(canvasStyleGroup);
    nodeGroup.appendChild(typeGroup);      
    square.style.display = 'none';   
    universe.appendChild(nodeGroup);
    
    handleInput();

    const deeplInputController = document.querySelector('deepl-input-controller');
    if (deeplInputController) {
        deeplInputController.remove();
    }
  
    input.addEventListener('focus', function() {
        styleGroup.setAttribute('visibility', 'visible');       
        typeGroup.setAttribute('visibility', 'hidden');
        isTyping = true;
    });

    input.addEventListener('blur', function() {
        styleGroup.setAttribute('visibility', 'hidden'); 
        save(nodeGroup);
    });

    input.addEventListener('mousedown', function(event) {
        if(nodeGroup.getAttribute('lock') === '1') { 
            event.preventDefault();
            return;
        }

        isTyping = true;
        hitbox.classList = 'hitbox';
        selectedNodes = selectedNodes.filter(item => item !== nodeGroup);
        typeGroup.style.display = 'none';
    });

    input.focus(); 
      
    function handleInput() {
        nodetypedropdown.value = 'text';    
        var event = new Event('change');
        nodetypedropdown.dispatchEvent(event);
        isTyping = true;
    }

    input.addEventListener('input', function() { 
        handleInput();
    });
    input.addEventListener('blur', function() { 
        nodeGroup.setAttribute('textcontent', input.innerHTML);      
        isTyping = false;
    });
    input.addEventListener('paste', function(event) {
        // Get the current input value and the pasted content
        const pastedText = event.clipboardData.getData('text');
               
        // Check if the combined length would exceed 1000 characters
        if (pastedText.length > 1000) {            
            // Prevent the default paste action
            event.preventDefault();

            let popup = document.createElement('div');
            popup.addEventListener('contextmenu', (event) => {
                event.preventDefault();
            });
            popup.className = 'popup'; 
            const message = document.createElement('div');
            message.className = 'smallmessage';   
            message.style.marginBottom = '0px';       
            message.textContent = `Paste content cannot exceed 1000 characters`;
            popup.appendChild(message);
            document.body.appendChild(popup);
            popup.addEventListener('wheel', function(event) {
                event.preventDefault();
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
    });

   
    //////////////////// INTERACTIONS WITHIN NODE ////////////////////
    nodeGroup.addEventListener('mousedown', function(event) {
        if(!input.contains(event.target) && !nodetypedropdown.contains(event.target) && !fontdropdown.contains(event.target) && !videoinput.contains(event.target) && !slider.contains(event.target)){
            event.preventDefault();
        }            
    });

    nodeGroup.addEventListener('mousedown', function(event) {
        if (event.button === 2) { 
            flipCoin(this);
            const heart = document.createElement('img');
            heart.style.position = 'absolute'; // Change to absolute for precise placement
            heart.style.pointerEvents = 'none';
            heart.style.width = '20px';
            heart.style.height = '20px';
            heart.style.display = 'block';
            heart.style.transition = 'width 1s ease, height 1s ease, opacity 0.2s ease'; 
            const rect =  nodeGroup.children[1].getBoundingClientRect();           
            const x = 100*(rect.x+rect.width/2)/(window.innerWidth);
            const y = 100*(rect.y+rect.height/2)/(window.innerHeight);
            heart.style.left = x+'%'; 
            heart.style.top = y+'%'; 
            heart.style.transform = 'translate(-50%, -50%) scale(1)'; 
            heart.setAttribute('src', '/static/img/hearts.svg');
            document.body.appendChild(heart);
            const size = 320*currentZoom
            setTimeout(() => {
                heart.style.width = size+'px';
                heart.style.height = size+'px';              
            }, 300);
            setTimeout(() => {
                heart.style.opacity = '0'; // Fades out           
            }, 1000);
            setTimeout(() => {
                document.body.removeChild(heart);
                nodeGroup.setAttribute('likes',parseInt(nodeGroup.getAttribute('likes'))+1);
            }, 1500);
        }
    });


    //////////////////// TEXT MODE ////////////////////

    foreignObject.addEventListener('mouseenter', function(event) { 
        if(!isSizing){
            CurrentNode(nodeGroup);
        }
        if(nodeGroup.getAttribute('lock') === '1') { 
            event.preventDefault();
            return;
        } else if (nodeGroup.getAttribute('type') === 'video' && hitbox.style.fill === 'none' && !videoinput.disabled) { 
            videoinput.style.display = 'block';
            leftButton.style.display = 'block';
            rightButton.style.display = 'block';
        } else if (nodeGroup.getAttribute('type') === 'canvas' && hitbox.style.fill === 'none') {        
            canvasStyleGroup.setAttribute('visibility', 'visible');  
        } else if(nodeGroup.getAttribute('type') === 'file' && hitbox.style.fill === 'none') {              
            fileGroup.setAttribute('visibility', 'visible'); 
        }        
    });

    foreignObject.addEventListener('mouseout', function(event) {
        if(!isSizing){
            CurrentNode(nodeGroup);
        } 
    });

    foreignObject.addEventListener('mousedown', function(event) {
        if(nodeGroup.getAttribute('lock') === '1') {
            event.preventDefault();
            return;
        }
        if (nodeGroup.getAttribute('type') === 'text' && !selectionArea(event, currentNode, 'up') && currentNode === nodeGroup && !input.contains(event.target)) {
            // event.preventDefault();        
            setTimeout(function() {           
                input.focus(); 
                var range = document.createRange();
                var selection = window.getSelection();        
                range.selectNodeContents(input);  
                range.collapse(false);          
                selection.removeAllRanges();  
                selection.addRange(range);
            }, 200); 
        } 
        else if(nodeGroup.getAttribute('type') === 'file') {              
            fileGroup.setAttribute('visibility', 'visible'); 
        } else if (nodeGroup.getAttribute('type') === 'canvas') {        
            canvasStyleGroup.setAttribute('visibility', 'visible');  
        } else  if (nodeGroup.getAttribute('type') === 'image') {
            img.style.display = 'block';                   
        } else if (nodeGroup.getAttribute('type') === 'video') { 
            videoinput.style.display = 'block';
            leftButton.style.display = 'block';
            rightButton.style.display = 'block';
        }
    });

 
    boldButtonfo.addEventListener('mousedown', function(event) {
        event.preventDefault();
    });
    boldButtonimg.addEventListener('mousedown', function() {
        var savedSelection = saveSelection();
              
        document.execCommand('bold', false, null);         
        boldButtonimg.setAttribute('src', '/static/img/bold-selected.svg');  
       
        setTimeout(function() {            
            input.focus(); 
            restoreSelection(savedSelection);
        }, 200);

    });

    ['mouseup', 'mouseout'].forEach(event => {
        boldButtonimg.addEventListener(event, function () {
            if (dark) {
                boldButtonimg.setAttribute('src', '/static/img/bold.svg');
            } else {
                boldButtonimg.setAttribute('src', '/static/img/bold-light.svg');
            }
        });
    });

    italicButtonfo.addEventListener('mousedown', function(event) {
        event.preventDefault();
    });
    italicButtonimg.addEventListener('mousedown', function() {
        var savedSelection = saveSelection();
             
        document.execCommand('italic', false, null);  
        italicButtonimg.setAttribute('src', '/static/img/italic-selected.svg');       
              
        setTimeout(function() {            
            input.focus(); 
            restoreSelection(savedSelection);
        }, 200);       
    });

    ['mouseup', 'mouseout'].forEach(event => {
        italicButtonimg.addEventListener(event, function () {
            if (dark) {
                italicButtonimg.setAttribute('src', '/static/img/italic.svg');
            } else {
                italicButtonimg.setAttribute('src', '/static/img/italic-light.svg');
            }
        });
    });


    underlineButtonfo.addEventListener('mousedown', function(event) {
        event.preventDefault();
    });

    underlineButtonimg.addEventListener('mousedown', function() {
        var savedSelection = saveSelection();
             
        document.execCommand('underline', false, null);  
        underlineButtonimg.setAttribute('src', '/static/img/underline-selected.svg');  
   
        setTimeout(function() {            
            input.focus(); 
            restoreSelection(savedSelection);
        }, 200);   
    });

    ['mouseup', 'mouseout'].forEach(event => {
        underlineButtonimg.addEventListener(event, function () {
            if (dark) {
                underlineButtonimg.setAttribute('src', '/static/img/underline.svg');
            } else {
                underlineButtonimg.setAttribute('src', '/static/img/underline-light.svg');
            }
        });
    });

    textColorButtonimg.addEventListener('mousedown', function(event) {
        event.stopPropagation();
        CurrentNode(nodeGroup);
        dragUniverse(0,0);
        if (colorWheelfo.getAttribute('visibility') === 'hidden') {
            colorWheelfo.setAttribute('visibility', 'visible');
            const event = new Event('visible');
            picker.canvas.dispatchEvent(event);
            svg.insertBefore(colorWheelfo, null);
            styleGroup.setAttribute('visibility', 'hidden');
            picker.setShowTriangle(false);
            picker.setHSV(194, .8, .8);
            colorContext = 'text';
            quickSize(nodeGroup);
        } 
    });


    fontsOver = false;
    fontdropdown.addEventListener('mouseover', function() {
        createTooltip (this.id,'Font size');  
        fontsOver = true;
        input.addEventListener('blur', function(event) {
            if(fontsOver){
                event.preventDefault();      
                // Keep the input field focused
                input.focus();
                restoreSelection(fontSavedSelection);
            }
        });      
    });

    styleGroup.addEventListener('mouseout', function() {
        deleteTooltip();   
        fontsOver = false;
    });
    let fontSavedSelection ;
    fontdropdown.addEventListener('mousedown', function(event) {
        fontSavedSelection = saveSelection();    
    });

    fontdropdown.addEventListener('change', function(event) {
        
        const selectedOption = event.target.value;
        
        setTimeout(function() {            
            input.focus(); 
            restoreSelection(fontSavedSelection);
            document.execCommand('fontSize', false, selectedOption); 
            event.target.value = '';
        }, 200); 
    });


    smileyButtonimg.addEventListener('mousedown', function() {
        var smileySavedSelection = saveSelection();       
        smileyButtonimg.setAttribute('src', '/static/img/smiley-selected.svg');  
        const smileys = document.getElementById('smileys');
        smileys.style.display = 'flex';
        smileys.children[0].scrollTop = 0;
        overlay = true; 

        smileys.addEventListener('visibilityChange', () => {
            if (smileys.style.display === 'none') {
                setTimeout(function() {            
                    input.focus(); 
                    const textNode = document.createTextNode(smileys.data);
                    smileySavedSelection.insertNode(textNode);
                    smileySavedSelection.setStartAfter(textNode);
                    smileySavedSelection.setEndAfter(textNode);
                    restoreSelection(smileySavedSelection);  
                    isDragging = false;                     
                }, 200); 
            } 
        }, { once: true });
        
        window.addEventListener('click', function(event) {
            if (event.target === smileys) {
                smileys.style.display = 'none';
                overlay = false;
            }
        });
    });

    ['mouseup', 'mouseout'].forEach(event => {
        smileyButtonimg.addEventListener(event, function () {
            if (dark) {
                smileyButtonimg.setAttribute('src', '/static/img/smiley.svg');
            } else {
                smileyButtonimg.setAttribute('src', '/static/img/smiley-light.svg');
            }
        });
    });

   
    //////////////////// IMAGE MODE ////////////////////

    img.addEventListener('dblclick', function(event) {
        if(nodeGroup.getAttribute('lock') === '0') { 
            nodetypedropdown.value = 'image';
            // Create a new 'change' event
            var event = new Event('change');
            loadimage = true;
            // Dispatch the 'change' event on nodetypedropdown
            nodetypedropdown.dispatchEvent(event);
        }
    });

    const longClickDuration = 1000; // 1 second for long click
    let mouseDownTimer = null;

    img.addEventListener('mousedown', function(event) {
        event.preventDefault();  
        if (hitbox.style.fill === 'none' && nodeGroup.getAttribute('lock') === '0') {
            createTooltip (this.id,'Double-click');          
        } 
         // Start a timer to detect long click
        mouseDownTimer = setTimeout(function() {
            // Trigger download on long click
            downloadImage(img);
        }, longClickDuration);
    });

    function downloadImage(imageElement) {
        const imageUrl = imageElement.src;
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = imageElement.alt || 'downloaded-image'; // Set a default filename (image alt text or fallback)
        link.click();
    }

    img.addEventListener('mouseup', function() {
        clearTimeout(mouseDownTimer); 
    });
 
    img.addEventListener('mouseout', function() {
        deleteTooltip();  
        clearTimeout(mouseDownTimer); 
    });

    //////////////////// CANVAS MODE ////////////////////
    let canvasUndoCounter = 0;
    let preventDrawing = false;

    // BASIC SHAPES
    // Circle
    canvasCircleButtonimg.addEventListener('mousedown', function() { 
        var drawingDataString = nodeGroup.getAttribute('canvascontent');
 
        // Parse the string back into an array of objects    
        try {
            drawingData = drawingDataString ? JSON.parse(drawingDataString) : [];
            console.log(canvasUndoCounter,drawingData)
            if(canvasUndoCounter !== 0) {
                drawingData.splice(canvasUndoCounter);
                canvasUndoCounter = 0;
            }
            
        } catch (error) {
            console.error('Error parsing JSON:', error);
            drawingData = []; // Default to empty object if parsing fails
        }

        if(!isErasing && !preventDrawing){
            canvasCircleButtonimg.setAttribute('src', '/static/img/circle-selected.svg');          
            preventDrawing = true;  
            var canvasID = canvas.getAttribute('id');
            canvas.addEventListener('mousedown', function(event) {
                drawCircle(event,canvasID, canvasCircleButtonimg, drawingData, nodeGroup)
            }, { once: true });
        }        
    });
   
    canvasCircleButtonimg.addEventListener('mouseover', function() {
        createTooltip (this.id,'Draw circle');  
    });

    ['mouseup', 'mouseout'].forEach(event => {
        canvasCircleButtonimg.addEventListener(event, function () {
            if (dark) {
                canvasCircleButtonimg.setAttribute('src', '/static/img/circle.svg');
            } else {
                canvasCircleButtonimg.setAttribute('src', '/static/img/circle-light.svg');
            }
        });
    });


    // Line
    canvasLineButtonimg.addEventListener('mousedown', function() { 
        var drawingDataString = nodeGroup.getAttribute('canvascontent');
     
        // Parse the string back into an array of objects    
        try {
            drawingData = drawingDataString ? JSON.parse(drawingDataString) : [];
            if(canvasUndoCounter !== 0) {
                drawingData.splice(canvasUndoCounter);
                canvasUndoCounter = 0;
            }
        } catch (error) {
            console.error('Error parsing JSON:', error);
            drawingData = []; // Default to empty object if parsing fails
        }

        if(!isErasing && !preventDrawing){
            canvasLineButtonimg.setAttribute('src', '/static/img/line-selected.svg');            
            preventDrawing = true;
            var canvasID = canvas.getAttribute('id');
            canvas.addEventListener('click', function(event) {
                drawLine(event, canvasID, canvasLineButtonimg, drawingData, nodeGroup);
            }, { once: true });
        }        
    });
   
    canvasLineButtonimg.addEventListener('mouseover', function() {
        createTooltip (this.id,'Draw line');  
    });

    ['mouseup', 'mouseout'].forEach(event => {
        canvasLineButtonimg.addEventListener(event, function () {
            if (dark) {
                canvasLineButtonimg.setAttribute('src', '/static/img/line.svg');
            } else {
                canvasLineButtonimg.setAttribute('src', '/static/img/line-light.svg');
            }
        });
    });

    // Remove Objects

    canvas.addEventListener('mousedown', function(event) {
        if (isErasing) {
            var drawingDataString = nodeGroup.getAttribute('canvascontent');
            try {
                drawingData = drawingDataString ? JSON.parse(drawingDataString) : [];
            } catch (error) {
                console.error('Error parsing JSON:', error);
                drawingData = []; 
            }
            var canvasID = canvas.getAttribute('id');
            const rect = canvas.getBoundingClientRect();
            const mouseX = (event.clientX - rect.left) / currentZoom;
            const mouseY = (event.clientY - rect.top) / currentZoom;
            // Call the function to remove intersecting objects
            drawingData, canvasUndoCounter = removeIntersectingObjects(drawingData, mouseX, mouseY, canvasUndoCounter);
            drawingDataString = JSON.stringify(drawingData);
            nodeGroup.setAttribute('canvascontent',drawingDataString);
            // Redraw the canvas to reflect the changes
            redrawCanvas(canvasID, canvasUndoCounter, drawingData);
        }
    });
    
    canvasEraserButtonimg.addEventListener('mousedown', function() {        
        isErasing = !isErasing;
        if (isErasing) {    
            customCursor.style.backgroundImage = '/static/img/eraser-cursor.svg'; 
            canvasEraserButtonimg.setAttribute('src', '/static/img/eraser-selected.svg');       
        } else {
            customCursor.style.backgroundImage = '/static/img/pen-cursor.svg';
            if (dark) {
                canvasEraserButtonimg.setAttribute('src', '/static/img/eraser.svg');
            } else {
                canvasEraserButtonimg.setAttribute('src', '/static/img/eraser-light.svg');
            }
        }
    });

    canvasEraserButtonimg.addEventListener('mouseover', function() {
        createTooltip (this.id,'Erase');  
    });

    // Clear canvas
   
    canvasClearButtonimg.addEventListener('mousedown', function() { 
        canvasClearButtonimg.setAttribute('src', '/static/img/eraseall-selected.svg');        

        // Parse the string back into an array of objects
        var drawingDataString = nodeGroup.getAttribute('canvascontent');
        try {
            drawingData = drawingDataString ? JSON.parse(drawingDataString) : [];
        } catch (error) {
            console.error('Error parsing JSON:', error);
            drawingData = []; 
        }       
      
        drawingData.length = 0;
        drawingDataString = JSON.stringify(drawingData);
        nodeGroup.setAttribute('canvascontent',drawingDataString);             
        canvasUndoCounter = 0
        redrawCanvas(canvasID, canvasUndoCounter, drawingData);
    });

    ['mouseup', 'mouseout'].forEach(event => {
        canvasClearButtonimg.addEventListener(event, function () {
            if (dark) {
                canvasClearButtonimg.setAttribute('src', '/static/img/eraseall.svg');
            } else {
                canvasClearButtonimg.setAttribute('src', '/static/img/eraseall-light.svg');
            }
        });
    }); 

    canvasClearButtonimg.addEventListener('mouseover', function() {
        createTooltip (this.id,'Clear canvas');  
    });

    // Undo

    canvasUndoButtonimg.addEventListener('mousedown', function() {
        canvasUndoButtonimg.setAttribute('src', '/static/img/undo-selected.svg');        
        var canvasID = canvas.getAttribute('id');
        var drawingDataString = nodeGroup.getAttribute('canvascontent');
        // Parse the string back into an array of objects
        var drawingData = JSON.parse(drawingDataString);
        if (drawingData.length > 0 && canvasUndoCounter > -drawingData.length){
            canvasUndoCounter -= 1;
        }     
        redrawCanvas(canvasID,canvasUndoCounter, drawingData);
    });

    ['mouseup', 'mouseout'].forEach(event => {
        canvasUndoButtonimg.addEventListener(event, function () {
            if (dark) {
                canvasUndoButtonimg.setAttribute('src', '/static/img/undo.svg');
            } else {
                canvasUndoButtonimg.setAttribute('src', '/static/img/undo-light.svg');
            }
        });
    }); 

    canvasUndoButtonimg.addEventListener('mouseover', function() {
        createTooltip (this.id,'Undo');  
    });

    // Redo

    canvasRedoButtonimg.addEventListener('mousedown', function() {
        canvasRedoButtonimg.setAttribute('src', '/static/img/redo-selected.svg');
        var canvasID = canvas.getAttribute('id');  
        var drawingDataString = nodeGroup.getAttribute('canvascontent');
        // Parse the string back into an array of objects
        var drawingData = JSON.parse(drawingDataString);
        if (drawingData.length > 0 && canvasUndoCounter < 0){
            canvasUndoCounter += 1;
        }  
        redrawCanvas(canvasID,canvasUndoCounter, drawingData);    
    });

    ['mouseup', 'mouseout'].forEach(event => {
        canvasRedoButtonimg.addEventListener(event, function () {
            if (dark) {
                canvasRedoButtonimg.setAttribute('src', '/static/img/redo.svg');
            } else {
                canvasRedoButtonimg.setAttribute('src', '/static/img/redo-light.svg');
            }
        });
    }); 

    canvasRedoButtonimg.addEventListener('mouseover', function() {
        createTooltip (this.id,'Redo');  
    });

    // Color

    canvasColorButtonimg.addEventListener('click', function() {
        CurrentNode(nodeGroup);
        dragUniverse(0,0);
        if (colorWheelfo.getAttribute('visibility') === 'hidden') {
            colorWheelfo.setAttribute('visibility', 'visible'); 
            const event = new Event('visible');
            picker.canvas.dispatchEvent(event);
            svg.insertBefore(colorWheelfo, null);
            canvasStyleGroup.style.display = 'none';
            colorContext = 'sketch';
            picker.setShowTriangle(false);
            picker.setHSV(194, .8, .8);
            quickSize(nodeGroup);
        } 
    });

    
    sliderdiv.addEventListener('mouseover', function() {
        createTooltip (this.id,'Line size');  
    });
    canvasColorButtonimg.addEventListener('mouseover', function() {
        createTooltip (this.id,'Line color');  
    });

    canvasStyleGroup.addEventListener('mouseout', function() {
        deleteTooltip();   
    });


    //////////////////// FILE MODE ////////////////////

    // UPLOAD FILE

    fileButton1input.addEventListener('change', function() {    
        const file = fileButton1input.files[0];
        const fileSize = (file.size / (1024 * 1024)).toFixed(2); // Size in MB
        console.log("File size: " + fileSize + " MB");               
        if (file) {
            var name = file.name;
            name = name.replace(/[^\w.-]/g, '');
            const formData = new FormData(); // Create FormData object
            formData.append('file', file); // Append the file to FormData object
            const nodeID = parseInt(nodeGroup.id.match(/\d+/)[0], 10);
            formData.append('fileName', name);
            nodeGroup.setAttribute('filename',name);
            formData.append('nodeID', nodeID);
            formData.append('layer', layerNumber);

            const csrfToken = getCookie('csrftoken');            
            spinner.style.display = 'block';
            fetch(this.getAttribute('hx-post'), {
                method: 'POST',
                headers: {
                    'X-CSRFToken': csrfToken,
                },
                body: formData, // Use FormData as the request body
            }).then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                console.log(name,fileButton3div)
                fileButton3div.textContent = name;
                fileButton3div.setAttribute('class', 'filename-content');
                const container = document.getElementById(`stlContainer-${nodeID}`);

                if (container) {
                    // Check if observer exists in the map
                    const resizeObserver = resizeObservers.get(number);                    
                    if (resizeObserver) {
                        // Unobserve and remove the observer
                        resizeObserver.unobserve(container);
                        resizeObservers.delete(number);  // Remove from the map
                    }                        
                    // Remove the container element
                    container.parentNode.removeChild(container);
                }
                return response.blob(); // Clone the response and get response body as Blob
            }).then(blob => {
                if (name.endsWith('.stl')) {
                    // Do something specific for .stl files
                    console.log('STL file detected');
                    spinner.style.display = 'none';
                    filePreview.style.display = 'none';
                    setTimeout(function() {
                        openFile(file, fileContainer);
                    }, 100);
                    nodeSizing(nodeGroup,200,200);
                }  else if (name.endsWith('.pdf')){
                    // Create an object URL from the Blob
                    var objectURL = URL.createObjectURL(blob);
                    const srcWithParams = objectURL + '#view=FitH&toolbar=1&navpanes=0&statusbar=0';
                    filePreview.style.display = 'block';                    
                    // Set the created PDF object as the src of the iframe
                    filePreview.src = srcWithParams;
                    spinner.style.display = 'none';
                    nodeGroup.setAttribute('file',nodeGroup.getAttribute('id'));
                    nodeSizing(nodeGroup,200,200);
                }  else  {
                    var fileTypeImg = document.createElement('img');
                    fileTypeImg.id = `fileTypeImg-${count}`;
                    fileTypeImg.className = 'filetypeimg';  
                    fileTypeImg.style.display = 'none'; 
                    fileContainer.appendChild(fileTypeImg);
                    var objectURL = URL.createObjectURL(blob);
                    filePreview.style.display = 'none';
                    fileTypeImg.style.display = 'block';        
                    fileTypeImg.src = objectURL; 
                    spinner.style.display = 'none';
                    nodeGroup.setAttribute('file',nodeGroup.getAttribute('id'));
                    nodeSizing(nodeGroup,125,125);
                }                  
                
                save(nodeGroup); 
                // nodeSelection(nodeGroup);    
                // nodeUnselection(nodeGroup);                
                fileButton3div.addEventListener('mouseover', function() {
                    createTooltip(fileButton3div.id,name);
                })
            })
            .catch(error => {
                console.error('Error fetching data:', error);
            });
        }
    });

    fileButton1div.addEventListener('mouseover', function() {
        svg.style.cursor = 'pointer';
        createTooltip (fileButton1img.id,'Upload file \n preview pdf/doc/ppt/stl');  
    });

    fileButton1div.addEventListener('mousedown', function() {
        fileButton1img.setAttribute('src', '/static/img/upload-selected.svg');
        setTimeout(() => {
            if (dark) {
                fileButton1img.setAttribute('src', '/static/img/upload.svg');
            } else {
                fileButton1img.setAttribute('src', '/static/img/upload-light.svg');
            }
        }, 100);
        fileButton1input.click(); 
    });

    // DOWNLOAD FILE

    fileButton2img.addEventListener('mouseover', function() {
        createTooltip (this.id,'Download file');  
    });
 
    fileButton2div.addEventListener('mousedown', function() {
        fileButton2img.setAttribute('src', '/static/img/download-selected.svg');
      
        const tagName = nodeGroup.getAttribute('filename');
        const id = parseInt(nodeGroup.id.match(/\d+/)[0], 10);
        const csrfToken = getCookie('csrftoken');

        fetch('/download-file/', {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tagName: tagName, id: id}) 
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.blob(); // Get the response as a Blob
        })
        .then(blob => {
            // Create a URL for the Blob
            const url = URL.createObjectURL(blob);
            // Create a link element
            const a = document.createElement('a');
            a.href = url;
            a.download = tagName; 
            document.body.appendChild(a); // Append the link to the document body
            internalLink = true;
            // Simulate a click on the link to trigger the download
            a.click();
            // Cleanup: remove the link and revoke the URL
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        })
        .catch(error => {
            console.error('There was a problem with the fetch operation:', error);
        });
    });


    ['mouseup', 'mouseout'].forEach(event => {
        fileButton2div.addEventListener(event, function () {
            if (dark) {
                fileButton2img.setAttribute('src', '/static/img/download.svg');
            } else {
                fileButton2img.setAttribute('src', '/static/img/download-light.svg');
            }
        });
    }); 

    // Handle supperposition of nodes of different sizes
    nodeGroup.addEventListener('mouseover', function(event) {
        if(!isTyping && nodeGroup.getAttribute('type') !== 'video' && nodeGroup.getAttribute('type') !== 'file' && !typeGroup.contains(event.target)){
            const mouseoverX = parseFloat(nodeGroup.getAttribute('x'));
            const mouseoverY = parseFloat(nodeGroup.getAttribute('y'));
            const mouseoverRadius = parseFloat(nodeGroup.children[1].getAttribute('r'));
            const nodes = document.querySelectorAll('.node-group');
            let maxRadius = Infinity; 
            nodes.forEach(function(node) {
                let x = parseFloat(node.getAttribute('x'));
                let y = parseFloat(node.getAttribute('y'));
                let radius = parseFloat(node.children[1].getAttribute('r'));
                if (((x + radius) < (mouseoverX + mouseoverRadius)) && ((x - radius) > (mouseoverX - mouseoverRadius)) 
                && ((y + radius) < (mouseoverY + mouseoverRadius)) && ((y - radius) > (mouseoverY - mouseoverRadius))) {
                    if (radius < maxRadius && !preview) {
                        maxRadius = radius;
                        universe.insertBefore(node, null);
                    }
                }
            });

        } else if (nodeGroup.getAttribute('type') === 'video' && hitbox.contains(event.target)) {
            semanticsearch.blur();
        }
     
        if(selectedNodes.includes(nodeGroup)){ 
            if(!isDragging && colorWheelfo.getAttribute('visibility') === 'hidden' && !portal){
                showParams(nodeGroup);  
            }                
            const noParams = selectedNodes.filter(currentNode => currentNode !== nodeGroup);
            noParams.forEach(function(node) {
                hideParams(node); 
            });   
        }           
    });
   
    foreignObject.addEventListener('click', function() {
        if (nodeGroup.getAttribute('type') === 'file' && filePreview.style.display === 'block' && filePreview.src !== '' && hitbox.style.fill === 'none' && !preview) {
            if (currentZoom > 0.5) {
                var wheelEvent = new WheelEvent('wheel', {
                    clientX: centerX,
                    clientY: centerY,
                    deltaX: 0, 
                    deltaY: 1,             
                });    
                while (currentZoom >= 0.5) {
                    zoom(wheelEvent)
                }
            } else {
                var wheelEvent = new WheelEvent('wheel', {
                    clientX: centerX,
                    clientY: centerY,
                    deltaX: 0, 
                    deltaY: -1,             
                });    
                while (currentZoom <= 0.5) {
                    zoom(wheelEvent)
                }
            }
            focusNode(nodeGroup);
            const screenSize = 4*window.innerHeight;
            nodeSizing(nodeGroup,screenSize,screenSize);
            filePreview.style.pointerEvents = 'auto';                  
            universe.insertBefore(nodeGroup, null); 
            setTimeout(() => {preview = true;}, 1000);  
        }                 
    });

    nodeGroup.addEventListener('mouseout', function(event) {
        deleteTooltip(); 
        if(nodeGroup.getAttribute('type') === 'file' && preview && filePreview.src !== ''){
            preview = false;
            filePreview.style.pointerEvents = 'none';
            nodeSizing(nodeGroup,200,200);
            var wheelEvent = new WheelEvent('wheel', {
                clientX: centerX,
                clientY: centerY,
                deltaX: 0, 
                deltaY: -1,             
            });             
            
            while (currentZoom <= 0.7) {
                zoom(wheelEvent)
            }     
            focusNode(nodeGroup);    
        }  
    });

          
    //////////////////// NODE PARAMS ////////////////////
    colorButtonimg.addEventListener('mouseover', function() {
        if (displayTutorial){
            const node0 = document.getElementById('node0')
            var tutobox_txt = node0.innerHTML;
            node0.innerHTML = 'Use the <strong>Chromatic wheel</strong> to adjust my <strong>ring color</strong>. This change can also be applied to a <strong>selection of nodes</strong> at once.';
            colorButtonimg.addEventListener('mouseout', function() {
                node0.innerHTML=tutobox_txt;
            }, { once: true });
        }
    });

    colorButtonimg.addEventListener('mousedown', function() {    
        CurrentNode(nodeGroup);
        if (colorWheelfo.getAttribute('visibility') === 'hidden') {
            typeGroup.setAttribute('visibility', 'hidden');
            colorWheelfo.setAttribute('visibility', 'visible');
            const event = new Event('visible');
            picker.canvas.dispatchEvent(event);
            svg.insertBefore(colorWheelfo, null);
            picker.setShowTriangle(true);
            picker.setHSV(194, .8, .8);
            colorContext = 'node';
            quickSize(nodeGroup);
            if(nodeGroup.getAttribute('shape') === 'circle') {
                hitbox.style.stroke = nodeGroup.getAttribute('color');
            }           
            quickSize(nodeGroup);  
            hideParams(nodeGroup);
            if (nodeGroup.getAttribute('type') === 'file') {
                fileGroup.style.display = 'block';
            } else if (nodeGroup.getAttribute('type') === 'canvas') {
                canvasStyleGroup.style.display = 'block';
            } else if (nodeGroup.getAttribute('type') === 'text') {
                styleGroup.style.display = 'block';
            }
        } 
    });

    shapeButtonimg.addEventListener('mouseover', function() {
        if (displayTutorial){
            const node0 = document.getElementById('node0')
            var tutobox_txt = node0.innerHTML;
            node0.innerHTML = 'The <strong>Shape tool</strong> is useful when you want to switch me into a square or to hide my boundaries. Like other settings, it can be applied to a <strong>selection of multiple nodes</strong>.';
            shapeButtonimg.addEventListener('mouseout', function() {
                node0.innerHTML=tutobox_txt;
            }, { once: true });
        }
    });

    shapeButtonimg.addEventListener('click', function() { 
        if(dark) {
            if (shapeButtonimg.getAttribute('src') === '/static/img/circle.svg') {
                selectedNodes.forEach(nodeGroup => {
                    if (nodeGroup.getAttribute('lock') === '0') {
                        nodeGroup.children[7].children[5].children[0].setAttribute('src', '/static/img/square.svg');
                        nodeGroup.children[1].style.stroke = 'transparent'; 
                        nodeGroup.setAttribute('shape','square');
                        nodeGroup.children[2].style.display = 'block';  
                        nodeGroup.children[2].setAttribute('class','squareShape');  
                        var links = JSON.parse(nodeGroup.getAttribute('links') || '[]');
          
                        links.forEach(id => {
                            const link = document.getElementById(id);
                            updateLink(link);             
                        }); 
                        quickSize(nodeGroup); 
                    }
                });
            } else if (shapeButtonimg.getAttribute('src') === '/static/img/square.svg') {
                selectedNodes.forEach(nodeGroup => {
                    if (nodeGroup.getAttribute('lock') === '0') {
                        nodeGroup.children[7].children[5].children[0].setAttribute('src', '/static/img/hide.svg');
                        nodeGroup.setAttribute('shape','none');
                        nodeGroup.children[2].style.display = 'none';                           
                    }
                });
            } else if (shapeButtonimg.getAttribute('src') === '/static/img/hide.svg') {
                selectedNodes.forEach(nodeGroup => {
                    if (nodeGroup.getAttribute('lock') === '0') {
                        nodeGroup.children[7].children[5].children[0].setAttribute('src', '/static/img/circle.svg');
                        nodeGroup.children[1].style.stroke = '#f3ee58'; 
                        nodeGroup.children[1].setAttribute('class', 'selectednode'); 
                        nodeGroup.setAttribute('shape','circle');
                    }
                });
            } 
        } else {
            if (shapeButtonimg.getAttribute('src') === '/static/img/circle-light.svg') {
                selectedNodes.forEach(nodeGroup => {
                    if (nodeGroup.getAttribute('lock') === '0') {
                        nodeGroup.children[7].children[5].children[0].setAttribute('src', '/static/img/square-light.svg');
                        nodeGroup.children[1].style.stroke = 'transparent'; 
                        nodeGroup.setAttribute('shape','square');
                        nodeGroup.children[2].style.display = 'block';  
                        nodeGroup.children[2].setAttribute('class','squareShape');  
                        var links = JSON.parse(nodeGroup.getAttribute('links') || '[]');
          
                        links.forEach(id => {
                            const link = document.getElementById(id);
                            updateLink(link);             
                        });  
                        quickSize(nodeGroup);                       
                    }
                });
            } else if (shapeButtonimg.getAttribute('src') === '/static/img/square-light.svg') {
                selectedNodes.forEach(nodeGroup => {
                    if (nodeGroup.getAttribute('lock') === '0') {
                        nodeGroup.children[7].children[5].children[0].setAttribute('src', '/static/img/hide-light.svg');
                        nodeGroup.setAttribute('shape','none');
                        nodeGroup.children[2].style.display = 'none';                           
                    }
                });
            } else if (shapeButtonimg.getAttribute('src') === '/static/img/hide-light.svg') {
                selectedNodes.forEach(nodeGroup => {
                    if (nodeGroup.getAttribute('lock') === '0') {
                        nodeGroup.children[7].children[5].children[0].setAttribute('src', '/static/img/circle-light.svg');
                        nodeGroup.children[1].style.stroke = nodeGroup.getAttribute('color'); 
                        nodeGroup.children[1].setAttribute('class', 'hitbox'); 
                        nodeGroup.setAttribute('shape','circle');
                    }
                });
            } 
        }
        showParams(nodeGroup);
    });

    calendarButtonimg.addEventListener('mouseover', function() {
        if (displayTutorial){
            const node0 = document.getElementById('node0')
            var tutobox_txt = node0.innerHTML;
            node0.innerHTML = 'You can set up reminders using the <strong>Calendar tool</strong>. Manage time with the notifications and navigation system included in each node.';
            calendarButtonimg.addEventListener('mouseout', function() {
                node0.innerHTML=tutobox_txt;
            }, { once: true });
        }
    });

    calendarButtonimg.addEventListener('click', function() { 
        const calendarOverlay = document.getElementById('calendarOverlay');
        if(nodeGroup.getAttribute('notification') !== '') {
            fp.setDate(nodeGroup.getAttribute('notification'));
        } else {
            fp.setDate(new Date());
        }       
        calendarOverlay.click();
        overlay = true;
    });

    nodetypedropdown.addEventListener('change', function() {
        hitbox.setAttribute('class', 'hitbox'); 
        selectedNodes.length = 0;  
        const match = nodeGroup.id.match(/\d+/);
        const number = match ? parseInt(match[0]) : null;     
       
        if (nodetypedropdown.value !== 'video' && players[number]) {
            players[number].pauseVideo();
        }
    });

    typeGroup.addEventListener('mouseout', function(event) {
        deleteTooltip();   
    });
    

    sizeButton.addEventListener('mouseover', function() {
        if (displayTutorial){
            const node0 = document.getElementById('node0')
            var tutobox_txt = node0.innerHTML;
            node0.innerHTML = 'I have an <strong>automatic sizing system</strong> but still you can resize one or more nodes at once by <strong>clicking and dragging</strong>.';
            sizeButton.addEventListener('mouseout', function() {
                node0.innerHTML=tutobox_txt;
            }, { once: true });
        }
    });

    lockButtonimg.addEventListener('mouseover', function() {
        if (displayTutorial){
            const node0 = document.getElementById('node0')
            var tutobox_txt = node0.innerHTML;
            node0.innerHTML = 'The <strong>Lock tool</strong> lets you prevent any changes to my content and <strong>pin my position</strong> in the universe. Like other settings, it can be applied to a <strong>selection of multiple nodes</strong>.';
            lockButtonimg.addEventListener('mouseout', function() {
                node0.innerHTML=tutobox_txt;
            }, { once: true });
        }
    });
    
    lockButtonimg.addEventListener('click', function() { 
        if(dark) {
            if (lockButtonimg.getAttribute('src') === '/static/img/lock.svg') {
                selectedNodes.forEach(nodeGroup => {
                    nodeGroup.children[7].children[7].children[0].setAttribute('src', '/static/img/unlock.svg');
                    nodeGroup.setAttribute('lock','0');
                    nodetypedropdown.disabled = false;
                });
            } else if (lockButtonimg.getAttribute('src') === '/static/img/unlock.svg') {
                selectedNodes.forEach(nodeGroup => {
                    nodeGroup.children[7].children[7].children[0].setAttribute('src', '/static/img/lock.svg');
                    nodeGroup.setAttribute('lock','1');
                    nodetypedropdown.disabled = true;
                });
            } 
        } else {
            if (lockButtonimg.getAttribute('src') === '/static/img/lock-light.svg') {
                selectedNodes.forEach(nodeGroup => {
                    nodeGroup.children[7].children[7].children[0].setAttribute('src', '/static/img/unlock-light.svg');
                    nodeGroup.setAttribute('lock','0');
                    nodetypedropdown.disabled = false;
                });
            } else if (lockButtonimg.getAttribute('src') === '/static/img/unlock-light.svg') {
                selectedNodes.forEach(nodeGroup => {
                    nodeGroup.children[7].children[7].children[0].setAttribute('src', '/static/img/lock-light.svg');
                    nodeGroup.setAttribute('lock','1');
                    nodetypedropdown.disabled = true;
                });
            } 
        }
    });

   
    layerButtonimg.addEventListener('mouseover', function() {
        if (displayTutorial){
            const node0 = document.getElementById('node0')
            var tutobox_txt = node0.innerHTML;
            node0.innerHTML = 'The <strong>Layer tool</strong> lets you move a node, or a group of nodes, across dimensions. By extension, it can even create a new dimension—though it’s never as simple as just pressing <strong>Enter</strong> on a selected node!';
            layerButtonimg.addEventListener('mouseout', function() {
                node0.innerHTML=tutobox_txt;
            }, { once: true });
        }
    });

    layerButtonimg.addEventListener('click', function() {
        if (displayTutorial){
            return;
        }
        quantum = true; 
        cancelList.length = 0;
        cancelIndex = 0;
        deleteNode(selectedNodes);
        setTimeout(() => {
            document.querySelector('.dropdown-button').click();
        }, 1);        
    });  

    var portal = false;
    quantumButtonimg.addEventListener('mouseover', function() {
        if (displayTutorial){
            const node0 = document.getElementById('node0')
            var tutobox_txt = node0.innerHTML;
            node0.innerHTML = 'The <strong>Portal tool</strong> lets you jumb across dimensions. End up at the end of the tunnel prealably set up using <strong>Enter</strong> on a selected node';
            quantumButtonimg.addEventListener('mouseout', function() {
                node0.innerHTML=tutobox_txt;
            }, { once: true });
        } else {
            // quantumButtonfo.style.animationDuration = '30S';
    
            portal = true;
            portalActivation();
            function portalActivation() {
                if(nodeGroup.getAttribute('shape') === 'square') {
                    nodeGroup.children[2].style.stroke = getRandomColor();
                } else {
                    nodeGroup.children[1].style.stroke = getRandomColor();
                }               
                setTimeout(() => {               
                    if (portal){
                        portalActivation();
                    }          
                }, 200); 
            }
        }
    });

    quantumButtonfo.addEventListener('mouseout', function() {
        if(nodeGroup.getAttribute('shape') === 'square') {
            nodeGroup.children[2].style.stroke = nodeGroup.getAttribute('color');
        } else {
            nodeGroup.children[1].style.stroke = nodeGroup.getAttribute('color');
        }   
        portal = false;
        // quantumButtonfo.style.animationDuration = '80S';       
    });

    quantumButtonimg.addEventListener('click', function() {
        if (displayTutorial){
            return;
        }
        hideParams(nodeGroup);
        const quantumData = JSON.parse(nodeGroup.getAttribute('quantum'));
        const layer = quantumData[0].layer
        const id = quantumData[0].node
        if (parseInt(layer) === layerNumber){
            focusNode(document.getElementById(id));
        } else {
            if(!admin) {
                load(layer,id);
            } else {
                adminload(userID,layer);
            }
        }     
    });  


    //////////////////// NODE CLICKS ////////////////////

    square.addEventListener('mouseout', function() {
        if (hitbox.classList[0] === 'hitbox') {
            square.style.strokeWidth = '4px';
        }
        out(nodeGroup);
    });


    hitbox.addEventListener('mouseout', function() {
        if (hitbox.classList[0] === 'hitbox') {
            hitbox.style.strokeWidth = '4px';
        }    
        out(nodeGroup);       
    });
    

    //////////////////// DEV GET NODE COORDINATES AND DISPLAY AS TOOLTIP ////////////////////


    nodeGroup.addEventListener('mouseover', function(event) {                
    
        const nodeId = nodeGroup.getAttribute('id');
        const nodeCoorX = parseFloat(nodeGroup.getAttribute('x'));
        const nodeCoorY = parseFloat(nodeGroup.getAttribute('y'));
        const layer = parseFloat(nodeGroup.getAttribute('layer'));
              
        const coordinates = `(${Math.round(nodeCoorX)},${Math.round(nodeCoorY)},${layer})`;

        // Create or update the tooltip text element
        const tooltipDev = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        tooltipDev.textContent = `${nodeId},${coordinates}`;
        tooltipDev.setAttribute('x', event.clientX + 10); 
        tooltipDev.setAttribute('y', event.clientY - 10); 
        tooltipDev.setAttribute('class', 'tooltipdev'); 

        // Remove any existing tooltip before adding the updated one
        const existingTooltipDev = svg.querySelector('.tooltipdev');
        if (existingTooltipDev) {
            svg.removeChild(existingTooltipDev);
        }

        // Add the tooltip text element to the SVG
       //svg.appendChild(tooltipDev);  

    });
    nodeGroup.addEventListener('mouseout', function(event) {
        // Remove the tooltip text element when mouse leaves the node 
        const existingTooltip = svg.querySelector('.tooltipdev');
        if (existingTooltip) {
            svg.removeChild(existingTooltip);
        }   
    });
    nodeGroup.style.display = 'block';
    return nodeGroup;
}


// originCoordinates();
// function originCoordinates() {
                
//     // Remove any existing tooltip before adding the updated one
//     const existingTooltipDev = svg.querySelector('.tooltipdev');
//     if (existingTooltipDev) {
//         svg.removeChild(existingTooltipDev);
//     }

//     const nodeCoorX = parseFloat(root.getAttribute('x'))/currentZoom;
//     const nodeCoorY = parseFloat(root.getAttribute('y'))/currentZoom;
          
//     const coordinates = `(${Math.round(nodeCoorX)}, ${Math.round(nodeCoorY)},${layerNumber})`;

//     // Create or update the tooltip text element
//     const tooltipDev = document.createElementNS('http://www.w3.org/2000/svg', 'text');
//     tooltipDev.textContent = `${coordinates}`;
//     tooltipDev.setAttribute('x', centerX); // Position the tooltip slightly to the right of the mouse cursor
//     tooltipDev.setAttribute('y', centerY); // Position the tooltip slightly above the mouse cursor
//     tooltipDev.setAttribute('class', 'tooltipdev'); 
//     svg.appendChild(tooltipDev); 
    
//     setTimeout(() => {
//         originCoordinates();
//     }, 1000);  

// }


























