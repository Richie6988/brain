///////////////////////////////////////////////////////////
//////////////////// KEYBOARD TRIGGERS ////////////////////
///////////////////////////////////////////////////////////

var isCtrlPressed = false;
let copy =[];
let copylink =[];
let copytemplate =[];
let mouseX = 0;
let mouseY = 0;
let barX = 0;
let barY = 0;
let cut = false;
let justPaste = false;


// Event listener for keydown event to detect Ctrl key press
if(!isCtrlPressed) {
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Control') {
            isCtrlPressed = true;
        }
        if (event.key === 'Shift' && !isTyping  && !overlay) {
            // document.querySelector('.dropdown-button').click();
            const dropdownContent = document.getElementById('dropdown-content');
            dropdownContent.style.display = dropdownContent.style.display === 'block' ? 'none' : 'block';
        }
        // Search
        if (event.ctrlKey && (event.key === 'f' || event.key === 'F')) {
            event.preventDefault();
            const buttonContainer = document.getElementById('button-container');
            const search = document.getElementById('semanticsearch');
            const indicator = document.getElementById("indicator");
            buttonContainer.classList.add("show");
            indicator.style.backgroundColor = 'transparent'; 
            search.focus();
            isTyping = true;
        }
        // Copy
        if (event.ctrlKey && (event.key === 'c' || event.key === 'C')) {
            copynodes();
        }   
        // Cut        
        if (event.ctrlKey && (event.key === 'x' || event.key === 'X')) {
            cutnodes();
        } 
        // Paste
        if (!isTyping && event.ctrlKey && (event.key === 'v' || event.key === 'V')) {
            if (!isTyping) {
                event.preventDefault();
            } 
            pastenodes();                          
        }
        // Selection
        if (!isTyping && event.ctrlKey && (event.key === 'a' || event.key === 'A')) {
            event.preventDefault();
            const nodeGroup = document.querySelectorAll('.node-group');
            nodeGroup.forEach(node => {          
                if (node.style.display === 'block') {
                    nodeSelection(node);
                }              
            }); 
            // Templates selection
            const templates = document.querySelectorAll('.template');
            templates.forEach(template => {
                const shapes = template.querySelectorAll('*:not(text)');                
                shapes.forEach(shape => {
                    // Apply the hover effect: bigger stroke and color change
                    shape.classList.add('template-rect-hover');  
                });
                if (!selectedTemplates.includes(template)) {
                    selectedTemplates.push(template);
                }
            }); 
        }
        // Cancel
        if (event.ctrlKey && (event.key === 'z' || event.key === 'Z') && !isTyping) {
            event.preventDefault();
            isCtrlPressed = false;
            cancel();
        } 
        // Delete
        if (!isTyping && (event.key === 'Delete' || event.key === 'Backspace')) {
            if (cancelIndex > 0){
                cancelList.length = 0;
                cancelIndex = 0;
            }
            if (selectedNodes.length !== 0 && selectedTemplates.length !== 0) {
                doubleCancel.push([cancelList.length,cancelList.length+1]);
            }
            if (selectedNodes.length !== 0) {
                deleteNode(selectedNodes);
            } 
            if (selectedTemplates.length !== 0) {
                cancelList.push(['templatedeletion', Array.from(selectedTemplates).map(template => template.cloneNode(true))]);
                var data = [];
                selectedTemplates.forEach(template => {
                    data.push({templateid: parseInt(template.getAttribute('id').match(/\d+/)[0], 10)});
                    template.remove();
                });
                deleteFetch(data);
                selectedTemplates.length = 0; 
            }                 
        }
        // Refresh view
        if ((event.key === 'Escape')) {
                document.documentElement.requestFullscreen({
                navigationUI: 'hide' // Valid option for requestFullscreen
            }).then(response => {
                document.exitFullscreen();
    
            }).catch(error => {
                console.error('Error during fullscreen:', error);
            });          
        }
    });
}

// Event listener for keyup event to detect Ctrl key release
document.addEventListener('keyup', function(event) {
    if (event.key === 'Control') {
        isCtrlPressed = false;
    }
});

// Arrows navigation
document.addEventListener("keydown", function(event) {
    const arrowKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (arrowKeys.includes(event.key)) {
        handleArrowKeys(event);
    }
});
document.addEventListener("keyup", function(event) {
    keys[event.key] = false;
});

// Space bar creation
document.addEventListener('keydown', function(event) {
    if (selectedNodes.length > 0 && event.key === ' ') {
        // When the space bar is pressed, find selected nodes 
        if (selectedNodes.length < 2 && (selectedNodes[0].children[1].getAttribute('class') === 'selectednode' || selectedNodes[0].children[2].getAttribute('class') === 'selectednode') && !isTyping) {
            event.preventDefault();
            selectedNodes[0].children[1].style.fill = 'none';
  
            const newNode = createNode(mouseX,mouseY); 
            if(displayTutorial) {
                if(displayTutorial) {
                    if (nodeCounter === 1){
                        tutoPhase+=1;
                    }
                    tuto(newNode);
                }
            }
            newNode.setAttribute('color', selectedNodes[0].getAttribute('color'));            
            newNode.style.stroke = selectedNodes[0].getAttribute('color'); 
         
            selectedNodes.push(newNode);
            createLinks(selectedNodes);         

        } else if (selectedNodes.length > 1 && selectedNodes.length < 23 && !isTyping){
            // Create links between selected nodes
            createLinks(selectedNodes);

        } 

    } else if (!isTyping && event.key === ' '){
        event.preventDefault();   
        color = getRandomColor(); 
        newNode = createNode(mouseX,mouseY);
        if(displayTutorial) {
            if (nodeCounter === 1){
                tutoPhase+=1;
            }
            tuto(newNode);
        }
    }
});

let isFocused = true;
// Extreme zooming jumps
document.addEventListener('keydown', function(event) {
    if (event.key === 'Tab' && !isTyping){
        event.preventDefault();
        if (currentZoom < 0.3) { isFocused = false;} 
        if (!isFocused){      
            var wheelEvent = new WheelEvent('wheel', {
                clientX: mouseX,
                clientY: mouseY,
                deltaX: 0, 
                deltaY: -0.9,             
            });  
            while (currentZoom <= 1.2) {
                svg.dispatchEvent(wheelEvent);
            }    
            isFocused = true;
        } else {           
            var wheelEvent = new WheelEvent('wheel', {
                clientX: mouseX,
                clientY: mouseY,
                deltaX: 0, 
                deltaY: 0.9,             
            });  
            while (currentZoom >= 0.1) {            
                svg.dispatchEvent(wheelEvent);
            }    
            isFocused = false;
        }       
    }
});



///////////////////////////////////////////////////////////
//////////////////// KEYBOARD ACTIONS ////////////////////
///////////////////////////////////////////////////////////


//////////////////// COPY/CUT/PASTE ////////////////////

function copynodes (tunnel){
    copy.length = 0;
    copytemplate.length = 0;
    barX = barY = 0;

    if (tunnel && selectedNodes.length > 1) {
        selectedNodes = [selectedNodes[selectedNodes.length - 1]];
    }
   
    copy = copy.concat(selectedNodes).map(node => node.cloneNode(true));
    copytemplate = copytemplate.concat(selectedTemplates).map(template => template.cloneNode(true));
    

    selectedTemplates.forEach(template => {           
        const shapes = template.querySelectorAll('*:not(text)');
        shapes.forEach(shape => {
            shape.classList.remove('template-rect-hover');
        });
        template.children[0].style.display= 'none';  
        template.children[2].style.display= 'none';                            
    }); 
  
    copy.forEach(element => {
        barX += parseFloat(element.getAttribute('x'));
        barY += parseFloat(element.getAttribute('y'));
    });

    copytemplate.forEach(element => {
        barX += parseFloat(element.getAttribute('x'));
        barY += parseFloat(element.getAttribute('y'));
    });

    barX = (barX / (copy.length + copytemplate.length)).toFixed(3);
    barY = (barY / (copy.length + copytemplate.length)).toFixed(3); 
    cut = false; 

    if (copy && !tunnel) {
        copylinks();
    }
    selectedNodes.forEach(nodeGroup => {            
        if (!tunnel){
            nodeUnselection(nodeGroup);
        }
    });  
}

function copylinks() {
    copylink.length = 0; 
    if (copy && !isTyping){
        console.log(selectedNodes)
        selectedNodes.forEach(node => {
            const linksAttribute = JSON.parse(node.getAttribute('links') || '[]');
            linksAttribute.forEach(id => {
                const link = document.getElementById(id);              
                if (
                    link && (
                        (node.id === link.getAttribute('Node1') && 
                         selectedNodes.some(el => el.id === link.getAttribute('Node2'))) ||
                        (node.id === link.getAttribute('Node2') && 
                         selectedNodes.some(el => el.id === link.getAttribute('Node1')))
                    )
                ) {
                    if (!copylink.some(el => el.isEqualNode(link))) {
                        copylink.push(link.cloneNode(true));
                    } 
                }       
            });
        });  
    }
}

function cutnodes() {
    copy.length = 0;
    copytemplate.length = 0;
    barX = barY = 0;
    copy = copy.concat(selectedNodes).map(node => node.cloneNode(true));
    copytemplate = copytemplate.concat(selectedTemplates).map(template => template.cloneNode(true));
    if (copy) {
        copylinks();
    }
    deleteNode(selectedNodes); 
    selectedTemplates.forEach(template => {
        deleteFetch([{templateid: parseInt(template.getAttribute('id').match(/\d+/)[0], 10)}]); 
        template.remove();        
    });

    copy.forEach(element => {
        barX += parseFloat(element.getAttribute('x'));
        barY += parseFloat(element.getAttribute('y'));
    });

    copytemplate.forEach(element => {
        barX += parseFloat(element.getAttribute('x'));
        barY += parseFloat(element.getAttribute('y'));
    });

    barX = (barX / (copy.length + copytemplate.length)).toFixed(3);
    barY = (barY / (copy.length + copytemplate.length)).toFixed(3); 

    cut = true;      

    document.getElementById('customCursor').style.display = 'none';
    selectedNodes.length = 0;
    selectedTemplates.length = 0;
}


function pastenodes(tunnel) {
    var transfoX;
    var transfoY;
    var pasteNode;

    if (copy && !isTyping || tunnel ){           
        copy.forEach(element => {
            transfoX = 0;
            transfoY = 0;
            if (copy.length + copytemplate.length  > 1) {
                transfoX = parseFloat(parseFloat(element.getAttribute('x')) - barX).toFixed(3);
                transfoY = parseFloat(parseFloat(element.getAttribute('y')) - barY).toFixed(3);
            }
            if(tunnel || quantum) {
                mouseX = window.innerWidth/2;
                mouseY = window.innerHeight/2;
            }
           
            transfoX = parseFloat(transfoX)  + parseFloat(mouseX/currentZoom);
            transfoY = -parseFloat(transfoY) + parseFloat(mouseY/currentZoom);                    
            if (cut){
                const id = element.getAttribute('id');  
                pasteNode = createNode(transfoX*currentZoom,transfoY*currentZoom,id);
            } else {
                pasteNode = createNode(transfoX*currentZoom,transfoY*currentZoom);
            }
              
            copylink.some(link => {                                 
                if (element.getAttribute('id') === link.getAttribute('Node1')) {
                    link.setAttribute('Node1',pasteNode.getAttribute('id'));                    
                } else if (element.getAttribute('id') === link.getAttribute('Node2')){
                    link.setAttribute('Node2',pasteNode.getAttribute('id'));                               
                }
            });
             
            pasteNode.setAttribute('type', element.getAttribute('type'));
            pasteNode.setAttribute('layer',layerNumber);
            pasteNode.setAttribute('color', element.getAttribute('color'));
            pasteNode.setAttribute('shape', element.getAttribute('shape'));
            pasteNode.setAttribute('likes', 0);
            pasteNode.setAttribute('notification', element.getAttribute('notification'));
  
            if(element.getAttribute('shape') === 'none'){
                pasteNode.children[1].style.stroke = 'transparent';
                if (dark) {
                    pasteNode.children[7].children[5].children[0].setAttribute('src', '/static/img/hide.svg');
                } else {
                    pasteNode.children[7].children[5].children[0].setAttribute('src', '/static/img/hide-light.svg');
                }
            } else if(element.getAttribute('shape') === 'circle'){
                pasteNode.children[1].style.stroke = element.getAttribute('color');
                if (dark) {
                    pasteNode.children[7].children[5].children[0].setAttribute('src', '/static/img/circle.svg');
                } else {
                    pasteNode.children[7].children[5].children[0].setAttribute('src', '/static/img/circle-light.svg');
                }
            }  else if(element.getAttribute('shape') === 'square'){
                pasteNode.children[1].style.stroke = 'transparent';
                pasteNode.children[2].style.stroke = element.getAttribute('color');
                pasteNode.children[2].style.display = 'block';  
                pasteNode.children[2].setAttribute('class','squareShape'); 
                if (dark) {
                    pasteNode.children[7].children[5].children[0].setAttribute('src', '/static/img/square.svg');
                } else {
                    pasteNode.children[7].children[5].children[0].setAttribute('src', '/static/img/square-light.svg');
                }
            }  

            pasteNode.setAttribute('lock', element.getAttribute('lock'));
            if(element.getAttribute('lock') === '1'){
                if (dark) {
                    pasteNode.children[7].children[7].children[0].setAttribute('src', '/static/img/lock.svg');
                } else {
                    pasteNode.children[7].children[7].children[0].setAttribute('src', '/static/img/lock-light.svg');
                }
            } else {
                if (dark) {
                    pasteNode.children[7].children[7].children[0].setAttribute('src', '/static/img/unlock.svg');
                } else {
                    pasteNode.children[7].children[7].children[0].setAttribute('src', '/static/img/unlock-light.svg');
                }
            }  
            
            // Text
            pasteNode.children[0].children[0].innerHTML = element.children[0].children[0].innerHTML;
            pasteNode.setAttribute('textcontent',element.getAttribute('textcontent'));
            // Image
            pasteNode.children[0].children[1].src = element.children[0].children[1].src;
            pasteNode.setAttribute('imagecontent',element.children[0].children[1].src);
            // File
            const filePreview = pasteNode.children[0].children[2].children[0];
            const spinner = pasteNode.children[0].children[2].children[1];
            const fileContainer = pasteNode.children[0].children[2];
            const fileName = element.getAttribute('filename');
            pasteNode.children[5].children[2].children[0].textContent = element.children[5].children[2].children[0].textContent;
            
            // Video
            pasteNode.setAttribute('videocontent',element.getAttribute('videocontent'));   
            pasteNode.setAttribute('videolink',element.getAttribute('videolink'));                
            pasteNode.children[0].children[3].children[1].value = element.getAttribute('videolink');
            // Canvas
            pasteNode.setAttribute('canvascontent',element.getAttribute('canvascontent'));
            var drawingDataString = pasteNode.getAttribute('canvascontent');
            // Parse the string back into an array of objects
            var drawingData = JSON.parse(drawingDataString);              
            redrawCanvas(pasteNode.children[0].children[4].id,0, drawingData);

            pasteNode.children[1].setAttribute('r', parseFloat(element.children[1].getAttribute('r')));

            pasteNode.children[7].children[0].children[0].value = pasteNode.getAttribute('type'); 
            var event = new Event('change');

            if(pasteNode.getAttribute('type') === "file"){
                pasteNode.setAttribute('file',element.getAttribute('id'));
                pasteNode.setAttribute('filename',fileName);
                console.log(element.getAttribute('id'), fileName)
                loadFile(element.getAttribute('id'), fileName, spinner, filePreview, fileContainer);
            }
                    
            // 4D
            if(tunnel) {
                pasteNode.children[3].style.display = 'block';
                if(!dark){
                    pasteNode.children[3].children[0].children[0].classList.remove('raydark');
                    pasteNode.children[3].children[0].children[0].classList.add('raylight');
                } 
                pasteNode.style.visibility = 'hidden';

                let quantumData = JSON.parse(selectedNodes[0].getAttribute('quantum')); 
                quantumData.push({node: pasteNode.getAttribute('id'), layer: pasteNode.getAttribute('layer') });
                selectedNodes[0].setAttribute('quantum', JSON.stringify(quantumData));
                save(selectedNodes[0],tunnel);   

                quantumData = JSON.parse(pasteNode.getAttribute('quantum'));
                quantumData.push({node: selectedNodes[0].getAttribute('id'), layer: selectedNodes[0].getAttribute('layer') });
                pasteNode.setAttribute('quantum', JSON.stringify(quantumData));   

                save(pasteNode);                
                copy.length = 0;
            }  

            if (cut && JSON.parse(element.getAttribute('quantum')).length !== 0) {
                pasteNode.setAttribute('quantum', element.getAttribute('quantum')); 
                pasteNode.children[2].style.display = 'block';  
                const quantumData = JSON.parse(element.getAttribute('quantum'));
                const id = quantumData[0].node;
                saveQuantum(id,parseInt(pasteNode.id.match(/\d+/)[0], 10)); 
                if (parseInt(quantumData[0].layer) === layerNumber) {
                    document.getElementById(quantumData[0].node).children[3].style.display = 'block';  
                }
            }

            if(pasteNode.getAttribute('type') !== "text"){
                pasteNode.children[7].children[0].children[0].dispatchEvent(event);
            }

            quickSize(pasteNode); 

            // Reload for another paste
            element.setAttribute('id',pasteNode.getAttribute('id'));                               
        }); 
        copylink.forEach(link => {
            const node1 = document.getElementById(link.getAttribute('Node1'));
            const node2 = document.getElementById(link.getAttribute('Node2'));
            const id = link.getAttribute('id');          
            if(cut){
                createLink(node1,node2,id); 
            } else {
                createLink(node1,node2);  
            }  
        });

        copytemplate.forEach(template => {
            X = ((mouseX - centerX) + parseFloat(root.getAttribute('x')))/currentZoom;
            Y = ((mouseY - centerY) - parseFloat(root.getAttribute('y')))/currentZoom;
            if (copy.length + copytemplate.length > 1) {
                X += (parseFloat(template.getAttribute('x')) - barX);
                Y -= (parseFloat(template.getAttribute('y')) - barY);
            } 
            var pasteTemplate = createTemplate(X,-Y,template.getAttribute('type'),template.getAttribute('id'));
            pasteTemplate.setAttribute('layer', layerNumber);
            pasteTemplate.setAttribute('size', template.getAttribute('size'));
            pasteTemplate.setAttribute('lock', template.getAttribute('lock'));
            const transformAttr = pasteTemplate.getAttribute('transform');
            const transformRegex = /translate\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)\s*scale\((-?\d+\.?\d*)\)/;
            const match = transformAttr.match(transformRegex);
            const transX = parseFloat(match[1]);
            const transY = parseFloat(match[2]);    
            pasteTemplate.setAttribute('transform', 
                `translate(${transX}, ${transY}) scale(${parseFloat(template.getAttribute('size'))})`
            );  
            saveTemplate(pasteTemplate);
            selectedTemplates.length = 0;
        });

        if(cut) {
            copy.length = 0;
            copylink.length = 0;
            copytemplate.length = 0;
        } 
             
        justPaste = true;
        document.activeElement.blur(); // Avoid text input to be focused

        setTimeout(() => {
            isDragging = false;
            isSizing = false;
        }, 100);
       
        isCtrlPressed = false;
    }
    selectedNodes.length = 0;
}

//////////////////// CANCEL ////////////////////

function cancel()   {   
    cancelIndex ++;
    if (cancelIndex > cancelList.length){
        return;
    }
    const undo = (cancelList[cancelList.length - cancelIndex]);
    var action = undo[0];
    var object = undo[1];

    if (action === 'deletion') {
        object.forEach(node =>{
            node.node_id = parseInt(node.getAttribute('id').match(/\d+/)[0], 10);
            node.x_coordinate = parseInt(node.getAttribute('x'));
            node.y_coordinate = parseInt(node.getAttribute('y'));
            node.radius = node.children[1].getAttribute('r')
            node.type = node.getAttribute('type');
            node.color = node.getAttribute('color');
            if(quantum){
                node.layer__layer_id = layerNumber;  
                if(JSON.parse(node.getAttribute('quantum')).length > 0)  {
                    const quantumData = JSON.parse(node.getAttribute('quantum'));
                    const id = quantumData[0].node;
                    saveQuantum(id,node.node_id); 
                }                            
            } else {
                node.layer__layer_id = node.getAttribute('layer');
                if (JSON.parse(node.getAttribute('quantum')).length > 0){
                    const quantumData = JSON.parse(node.getAttribute('quantum'));
                    const id = quantumData[0].node;
                    saveQuantum(id,node.node_id);
                }               
            }    
       
            node.text_content = node.getAttribute('textcontent');
            node.image_content = node.getAttribute('imagecontent');
            node.canvas_content = node.getAttribute('canvascontent');
            node.video_content = node.getAttribute('videocontent');
            node.file_name = node.getAttribute('filename');
            node.file = node.getAttribute('file');
            node.quantum = node.getAttribute('quantum');
            node.notification = node.getAttribute('notification');
            node.shape = node.getAttribute('shape');
            if(node.getAttribute('lock') === '1') {
                node.lock = true;
            } else {
                node.lock = false;
            }
            
            displayNode(node);

            var siblingsArray = JSON.parse(node.getAttribute('siblings') || '[]');
            var linksArray = JSON.parse(node.getAttribute('links') || '[]');
      
            siblingsArray.forEach((connexion, index) => {
                const connectedNode = document.getElementById(connexion);
                if(connectedNode){
                    createLink(document.getElementById(node.getAttribute('id')),connectedNode,linksArray[index]); 
                }
            });
            originX = parseFloat(node.getAttribute('x'))/currentZoom;
            originY = - parseFloat(node.getAttribute('y'))/currentZoom;
        });
    } if (action === 'linkdeletion') {   
        const node1 = document.getElementById(object.getAttribute('Node1'));
        const node2 = document.getElementById(object.getAttribute('Node2'));
        const linkID = object.id; 
        console.log(linkID)                 
        createLink(node1,node2,linkID); 

    } if (action === 'templatedeletion') {   
        object.forEach(template =>{
            const redoTemplate = createTemplate(parseFloat(template.getAttribute('x')),parseFloat(template.getAttribute('y')),template.getAttribute('type'),template.getAttribute('id'));
            redoTemplate.setAttribute('layer', template.getAttribute('layer'));
            redoTemplate.setAttribute('size', template.getAttribute('size'));
            redoTemplate.setAttribute('templateID', template.getAttribute('id'));
            redoTemplate.setAttribute('type', template.getAttribute('type'));
            redoTemplate.setAttribute('lock', template.getAttribute('lock'));
            saveTemplate(redoTemplate);
        });
    }

    // var event = new MouseEvent('mousedown');
    // svg.dispatchEvent(event);    
    // event = new MouseEvent('mouseup');
    // svg.dispatchEvent(event);
    document.activeElement.blur();

    if(doubleCancel.some(sublist => sublist.includes(cancelList.length - cancelIndex))) {
        cancel();
    } 
}



//////////////////// GETTING ARROW KEYS INPUTS ////////////////////

const keys = {
    ArrowLeft: false,
    ArrowUp: false,
    ArrowRight: false,
    ArrowDown: false
};


function handleArrowKeys(event) {
    let vector = { x: 0, y: 0 };
    keys[event.key] = true;
       
    // Fallback to standard arrow key detection
    switch (true) {
        case keys.ArrowLeft && keys.ArrowUp:
            //console.log("ArrowLeft and ArrowUp are pressed simultaneously.");
            vector.x = -0.7;
            vector.y = -0.7;
            break;
        case keys.ArrowLeft && keys.ArrowDown:
            //console.log("ArrowLeft and ArrowDown are pressed simultaneously.");
            vector.x = -0.7;
            vector.y = 0.7;
            break;
        case keys.ArrowRight && keys.ArrowUp:
            //console.log("ArrowRight and ArrowUp are pressed simultaneously.");
            vector.x = 0.7;
            vector.y = -0.7;
            break;
        case keys.ArrowRight && keys.ArrowDown:
            //console.log("ArrowRight and ArrowDown are pressed simultaneously.");
            vector.x = 0.7;
            vector.y = 0.7;                
            break;
        case keys.ArrowLeft:
            //console.log("ArrowLeft is pressed.");
            vector.x = -1;
            break;
        case keys.ArrowUp:
            //console.log("ArrowUp is pressed.");
            vector.y = -1;
            break;
        case keys.ArrowRight:
            //console.log("ArrowRight is pressed.");
            vector.x = 1;
            break;
        case keys.ArrowDown:
            //console.log("ArrowDown is pressed.");
            vector.y = 1;
            break;
        default:
            break;
    }

    // If no nodeGroup is selected, execute the arrow key logic
    if (!isTyping && selectedNodes.length === 0) {
        dragUniverse(-vector.x*4 , -vector.y*4 , false);   
    }
}


//////////////////// LINKS ////////////////////

function createLinks(nodes) {
    // Create links between all pairs of selected nodes
    for (let i = 0; i < nodes.length - 1; i++) {
        for (let j = i + 1; j < nodes.length; j++) {         
            checkExistingLinks(nodes[i], nodes[j]);     
        }
    }

    nodes.forEach(node => {
        nodeUnselection(node);
    });       
}

function checkExistingLinks(nodeA,nodeB) {
    const links = document.querySelectorAll('.link');
    var check = false;
    links.forEach(link => {
        // Get the Node1 and Node2 attributes of the link
        const node1 = link.getAttribute('Node1');
        const node2 = link.getAttribute('Node2');

        // Check if the combination of Node1 and Node2 attributes already exists in uniqueLinks
        const combination = `${node1}-${node2}`;
        const combinationBis = `${node2}-${node1}`;
        const checkCombination = `${nodeA.getAttribute('id')}-${nodeB.getAttribute('id')}`;
        
        if (combination === checkCombination || combinationBis === checkCombination) {
            if (node1 !== node2) {
                check = true;
            }            
        }
    });
    if(!check) {
        createLink(nodeA, nodeB);   
    }
}

function createLink(nodeGroup1, nodeGroup2,id) {
    var linkID = id;
    if (!id) {
        linkCounter++;
        linkID = `L-${linkCounter}`;
    } 
    hideParams(nodeGroup1); 
    hideParams(nodeGroup2); 

    // Create a link element
    const link = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    link.style.strokeWidth = ''+3+'px'; 
    const transformAttr1 = nodeGroup1.getAttribute('transform');
    const transformAttr2 = nodeGroup2.getAttribute('transform');
    const transformRegex = /translate\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)\s*scale\((-?\d+\.?\d*)\)/;         
    const match1 = transformAttr1.match(transformRegex);  
    const match2 = transformAttr2.match(transformRegex); 

    const transfoX1 = parseFloat(match1[1]);
    const transfoY1 = parseFloat(match1[2]);
    const transfoX2 = parseFloat(match2[1]);
    const transfoY2 = parseFloat(match2[2]);

    const node1 = nodeGroup1.children[1];        
    const radiant1 = node1.getAttribute('r');
    const node2 = nodeGroup2.children[1];        
    const radiant2 = node2.getAttribute('r');

    var linkAngle = calculateLinkAngle(parseInt(transfoX1) + parseInt(centerX), 
    parseInt(transfoY1)+parseInt(centerY), 
    parseInt(transfoX2)+parseInt(centerX), 
    parseInt(transfoY2)+parseInt(centerY));

    var endpoint1 = calculateEndpoint(parseInt(transfoX1) + parseInt(centerX), parseInt(transfoY1)+parseInt(centerY), radiant1, linkAngle,nodeGroup1);
    var endpoint2 = calculateEndpoint(parseInt(transfoX2) + parseInt(centerX), parseInt(transfoY2)+parseInt(centerY), radiant2, linkAngle-180,nodeGroup2);
    
    const x1 =  endpoint1.x;
    const y1 = endpoint1.y;
    const x2 = endpoint2.x;
    const y2 = endpoint2.y;

    // Set link attributes
    link.setAttribute('id', linkID);
    link.setAttribute('x1', x1);
    link.setAttribute('y1', y1);
    link.setAttribute('x2', x2);
    link.setAttribute('y2', y2);
    link.setAttribute('Node1', nodeGroup1.getAttribute('id'));
    link.setAttribute('Node2', nodeGroup2.getAttribute('id'));
    link.setAttribute('layer', layerNumber);
    link.setAttribute('class', 'link');
    universe.insertBefore(link, universe.firstChild); 

    // Set the links array of the nodeGroup elements
    var linksArray1 = JSON.parse(nodeGroup1.getAttribute('links'));
    var linksArray2 = JSON.parse(nodeGroup2.getAttribute('links'));
    linksArray1.push(linkID);
    linksArray2.push(linkID);
    nodeGroup1.setAttribute('links', JSON.stringify(linksArray1));
    nodeGroup2.setAttribute('links', JSON.stringify(linksArray2));
    // Set the siblings array of the nodeGroup elements
    var siblingsArray1 = JSON.parse(nodeGroup1.getAttribute('siblings'));
    var siblingsArray2 = JSON.parse(nodeGroup2.getAttribute('siblings'));
    siblingsArray1.push(nodeGroup2.id);
    siblingsArray2.push(nodeGroup1.id);
    nodeGroup1.setAttribute('siblings', JSON.stringify(siblingsArray1));
    nodeGroup2.setAttribute('siblings', JSON.stringify(siblingsArray2));

    // Get the color attribute of Node1
    let color1 = nodeGroup1.getAttribute('color');
    let color2 = nodeGroup2.getAttribute('color');

    let gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    let gradientID = 'grad'+linkID;
    gradient.setAttribute("id", gradientID);

    var dx=x2-x1;
    var dy=y2-y1;
    var hyp = Math.sqrt(dx*dx+dy*dy);
    var sinang = dx/hyp;
    var cosang = dy/hyp;

    if (sinang>=0 && cosang>=0){
        gradient.setAttribute("x1","0%");
        gradient.setAttribute("y1","0%");
        gradient.setAttribute("x2",""+100*sinang+"%");
        gradient.setAttribute("y2",""+100*cosang+"%");
    } else if (sinang>=0 && cosang<0){
        gradient.setAttribute("x1","0%");
        gradient.setAttribute("y1",""+100*sinang+"%");
        gradient.setAttribute("x2",""-100*cosang+"%");
        gradient.setAttribute("y2","0%");
    }  else if (sinang<0 && cosang>=0){
        gradient.setAttribute("x1",""-100*sinang+"%");
        gradient.setAttribute("y1","0%");
        gradient.setAttribute("x2","0%");
        gradient.setAttribute("y2",""+100*cosang+"%");
    } else {
        gradient.setAttribute("x2","0%");
        gradient.setAttribute("y2","0%");
        gradient.setAttribute("x1",""-100*sinang+"%");
        gradient.setAttribute("y1",""-100*cosang+"%");
    }
    
    // Define gradient stops
    let stop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop1.setAttribute("offset", "11%");
    stop1.setAttribute("style", "stop-color:" + color1 + "; stop-opacity: 1;");
    gradient.appendChild(stop1);

    let stop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop2.setAttribute("offset", "88%");
    stop2.setAttribute("style", "stop-color: " + color2 + "; stop-opacity: 1;");
    gradient.appendChild(stop2);

    // Append the gradient to the SVG
    let defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.id = 'defs';
    defs.appendChild(gradient);
    universe.appendChild(defs);

    link.setAttribute('stroke', 'url(#' + gradientID + ')');

    if (linkState === 1) {
        gradient.style.display = 'none';
        link.style.stroke = '#379be7';
    } else 
    if (linkState === 2) {
        link.style.display = 'none';
    }

    let travelto;
    link.addEventListener('mouseover', (e) => {
        currentLink = link;
        // Get the coordinates of the line's start and end points
        const node1 = document.getElementById(link.getAttribute('Node1'));
        const node2 = document.getElementById(link.getAttribute('Node2'));

        const x1 = node1.getAttribute('x');
        const y1 = node1.getAttribute('y');
        const x2 = node2.getAttribute('x');
        const y2 = node2.getAttribute('y');
        
        const mouseX = Math.round((e.clientX - centerX) + parseFloat(root.getAttribute('x')))/currentZoom;
        const mouseY = -Math.round((e.clientY - centerY) - parseFloat(root.getAttribute('y')))/currentZoom;
    
        // Calculate distances from the cursor to the two ends of the line
        const distToStart = Math.hypot(mouseX - x1, mouseY - y1);
        const distToEnd = Math.hypot(mouseX - x2, mouseY - y2);    
        let angle;
        const nodes = document.querySelectorAll('.node-group');
        // Check which end of the line the cursor is closer to
        if (distToStart < distToEnd) {
            // Cursor is closer to (x1, y1), so point the arrow towards (x2, y2)
            angle = Math.atan2(y1 - y2, x2 - x1) * (180 / Math.PI); 
            travelto = node2;
        } else {
            // Cursor is closer to (x2, y2), so point the arrow towards (x1, y1)
            angle = Math.atan2(y2 - y1, x1 - x2) * (180 / Math.PI); 
            travelto = node1;
        }
    
        // Create the cursor using the Data URL, rotating it to match the calculated angle
        var cursorURL;

        cursorURL = `data:image/svg+xml;base64,${btoa(`
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="#1E90FF" stroke="transparent" transform="rotate(${angle})">
                <polygon points="12 2, 20 12, 12 22, 10 20, 14 12, 10 4" />
            </svg>
        `)}`; 

        // Apply the custom cursor
        link.style.cursor = `url(${cursorURL}) 16 16, auto`;
        if(currentZoom < 0.5) {
            link.style.strokeWidth = ''+7.5+'px'; 
        } else {
            link.style.strokeWidth ='5px'; 
        }
        
                           
        link.addEventListener('mousedown', (event) => {
            if (event.button === 0){
                focusNode(travelto,false);
            }                       
        }); 
        
        document.addEventListener('keydown', keydownHandler);                    
   
    });
    
    link.addEventListener('mouseout', () => {
        link.style.cursor = '';
        link.style.strokeWidth = ''+3+'px'; 
        document.removeEventListener('keydown', keydownHandler);
        currentLink = null;
    });

    function keydownHandler(event) {
        if (!isTyping && (event.key === 'Delete' || event.key === 'Backspace')) {
            if (cancelIndex > 0){
                cancelList.length = 0;
                cancelIndex = 0;
            }    
            cancelList.push(['linkdeletion', link.cloneNode(true)]);
            deleteLink(link);
            document.removeEventListener('keydown', keydownHandler);
        }
    }        
    save(nodeGroup1);
    save(nodeGroup2);
}

function deleteLink(link) {
    const data = [];
    const node1 = document.getElementById(link.getAttribute('Node1'));
    const node2 = document.getElementById(link.getAttribute('Node2'));

    const linkid = link.getAttribute('id');
    link.remove();
    let gradientID = 'grad' + linkid;
    let gradient = document.getElementById(gradientID);
    if (gradient) {
        gradient.remove();
    }     
    const id = linkid;

    const linksConnexion1 = JSON.parse(node1.getAttribute('links') || '[]'); 
    const linksConnexion2 = JSON.parse(node2.getAttribute('links') || '[]'); 
    const filteredIds1 = linksConnexion1.filter(link => link !== id); 
    const filteredIds2 = linksConnexion2.filter(link => link !== id); 
    node1.setAttribute('links', JSON.stringify(filteredIds1));
    node2.setAttribute('links', JSON.stringify(filteredIds2));
    const siblings1 = JSON.parse(node1.getAttribute('siblings') || '[]');
    const siblings2 = JSON.parse(node2.getAttribute('siblings') || '[]');;
    const filteredSiblings1 = siblings1.filter(e => e !== node2.id);
    const filteredSiblings2 = siblings2.filter(e => e !== node1.id);
    node1.setAttribute('siblings', JSON.stringify(filteredSiblings1));
    node2.setAttribute('siblings', JSON.stringify(filteredSiblings2));
    save(node1);
    save(node2);
    data.push({linkid: parseInt(id.match(/\d+/)[0], 10)}); 
    deleteFetch(data);
}

// Update link position
function updateLink(link) {  
    const nodeGroup1 = document.getElementById(link.getAttribute('Node1'));
    const nodeGroup2 = document.getElementById(link.getAttribute('Node2'));
    
    const transformAttr1 = nodeGroup1.getAttribute('transform');
    const transformAttr2 = nodeGroup2.getAttribute('transform');
    const transformRegex = /translate\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)\s*scale\((-?\d+\.?\d*)\)/;         
    const match1 = transformAttr1.match(transformRegex);  
    const match2 = transformAttr2.match(transformRegex); 

    const transfoX1 = parseFloat(match1[1]);
    const transfoY1 = parseFloat(match1[2]);
    const transfoX2 = parseFloat(match2[1]);
    const transfoY2 = parseFloat(match2[2]);

    const node1 = nodeGroup1.children[1];        
    const radiant1 = node1.getAttribute('r');
    const node2 = nodeGroup2.children[1];        
    const radiant2 = node2.getAttribute('r');

    var linkAngle = calculateLinkAngle(parseInt(transfoX1) + parseInt(centerX), 
    parseInt(transfoY1)+parseInt(centerY), 
    parseInt(transfoX2)+parseInt(centerX), 
    parseInt(transfoY2)+parseInt(centerY));
 
    var endpoint1 = calculateEndpoint(parseInt(transfoX1) + parseInt(centerX), parseInt(transfoY1)+parseInt(centerY), radiant1, linkAngle,nodeGroup1);
    var endpoint2 = calculateEndpoint(parseInt(transfoX2) + parseInt(centerX), parseInt(transfoY2)+parseInt(centerY), radiant2, linkAngle-180,nodeGroup2);
    
    const x1 =  endpoint1.x;
    const y1 = endpoint1.y;
    const x2 = endpoint2.x;
    const y2 = endpoint2.y;
    const offset = 0.01;

    // Set link attributes
    link.setAttribute('x1', x1 + offset);
    link.setAttribute('y1', y1 + offset);
    link.setAttribute('x2', x2 - offset);
    link.setAttribute('y2', y2 - offset);
    link.style.strokeWidth = ''+3+'px'; 
    universe.appendChild(link);
    universe.insertBefore(link, universe.firstChild); 
}

function updateLinkColor(link) {
    link.style.strokeWidth = ''+3+'px'; 
    link.style.stroke = '';
    const x1 = link.getAttribute('x1');
    const x2 = link.getAttribute('x2');
    const y1 = link.getAttribute('y1');
    const y2 = link.getAttribute('y2');
    const node1 = document.getElementById(link.getAttribute('Node1'));
    const color1 = node1.getAttribute('color');
    const node2 = document.getElementById(link.getAttribute('Node2'));
    const color2 = node2.getAttribute('color');
    const gradientID = 'grad'+link.getAttribute('id');
    const gradient = document.getElementById(gradientID);
    
    var dx=x2-x1;
    var dy=y2-y1;
    var hyp = Math.sqrt(dx*dx+dy*dy);
    var sinang = dx/hyp;
    var cosang = dy/hyp;
 
    if (sinang>0 && cosang>=0){
        gradient.setAttribute("x1","0%");
        gradient.setAttribute("y1","0%");
        gradient.setAttribute("x2",""+100*sinang+"%");
        gradient.setAttribute("y2",""+100*cosang+"%");
    } else if (sinang>=0 && cosang<0){
        gradient.setAttribute("x1","0%");
        gradient.setAttribute("y1",""+100*sinang+"%");
        gradient.setAttribute("x2",""-100*cosang+"%");
        gradient.setAttribute("y2","0%");
    }  else if (sinang<0 && cosang>=0){
        gradient.setAttribute("x1",""-100*sinang+"%");
        gradient.setAttribute("y1","0%");
        gradient.setAttribute("x2","0%");
        gradient.setAttribute("y2",""+100*cosang+"%");
    } else if (sinang<=0 && cosang<0){
        gradient.setAttribute("x2","0%");
        gradient.setAttribute("y2","0%");
        gradient.setAttribute("x1",""-100*sinang+"%");
        gradient.setAttribute("y1",""-100*cosang+"%");
    }
   
    // Define gradient stops
    gradient.children[0].setAttribute("offset", "11%");
    gradient.children[0].setAttribute("style", "stop-color:" + color1 + "; stop-opacity: 1;");

    gradient.children[1].setAttribute("offset", "88%");
    gradient.children[1].setAttribute("style", "stop-color: " + color2 + "; stop-opacity: 1;");
    
    link.setAttribute('stroke', 'url(#' + gradientID + ')');
}

// Function to calculate the angle of the link relative to the node's center
function calculateLinkAngle(nodeCenterX, nodeCenterY, linkEndpointX, linkEndpointY) {
    // Calculate the differences in x and y coordinates
    var dx = linkEndpointX - nodeCenterX;
    var dy = linkEndpointY - nodeCenterY;

    // Calculate the angle in radians
    var angleRad = Math.atan2(dy, dx);

    // Convert the angle from radians to degrees
    var angleDeg = angleRad * 180 / Math.PI;

    // Adjust the angle to be in the range [0, 360)
    if (angleDeg < 0) {
        angleDeg += 360;
    }

    return angleDeg;
}

// Function to calculate the endpoint coordinates on the circumference of a circular node
function calculateEndpoint(nodeCenterX, nodeCenterY, nodeRadius, linkAngle, node) {
    const shape = node.getAttribute('shape');
    // Convert the angle from degrees to radians
    var angleRad = linkAngle * Math.PI / 180;
    if (shape === 'circle' || shape === 'none') {
        // Calculate the x and y coordinates for a circular node
        var endpointX = nodeCenterX + nodeRadius * Math.cos(angleRad);
        var endpointY = nodeCenterY + nodeRadius * Math.sin(angleRad);
        return { x: endpointX, y: endpointY };
    } else if (shape === 'square') {
        // The square has the same center and diameter as the circle, so its side length is 2 * nodeRadius
        // var halfSide = nodeRadius;
        var halfSideX =  node.children[2].getBoundingClientRect().width/currentZoom/2;
        var halfSideY = node.children[2].getBoundingClientRect().height/currentZoom/2;
       
        var dx = Math.cos(angleRad);
        var dy = Math.sin(angleRad);
        
        // Determine which side of the square the endpoint lies on
        var tX = (dx !== 0) ? halfSideX / Math.abs(dx) : Infinity;
        var tY = (dy !== 0) ? halfSideY / Math.abs(dy) : Infinity;
        var t = Math.min(tX, tY);
        
        var endpointX = nodeCenterX + t * dx;
        var endpointY = nodeCenterY + t * dy;
        return { x: endpointX, y: endpointY };
    }
    
}

