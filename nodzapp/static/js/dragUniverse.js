//////////////////// DRAGGING THE WHOLE UNIVERSE ////////////////////
function dragUniverse(dragX,dragY,selection,zoom) {
    const transformAttr = universe.getAttribute('transform');
    const transformRegex = /translate\((-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)\s*scale\((-?\d+\.?\d*)\)/;                          
    const match = transformAttr.match(transformRegex);  
    const initialX = parseFloat(match[1]);
    const initialY = parseFloat(match[2]);

    universe.setAttribute('transform', `translate(${(dragX + initialX).toFixed(5)}, ${(dragY + initialY).toFixed(5)}) scale(${currentZoom})`);
   
    if (zoom !== 'zoom') {
        root.setAttribute('x', parseFloat(root.getAttribute('x')) - parseFloat(dragX));
        root.setAttribute('y', parseFloat(root.getAttribute('y')) + parseFloat(dragY)); 
    }

    if(selection) {
        dragSelected(-dragX, -dragY);        
    }

    // Functions to display or not nodes depending if they are on screen and count them
    dispatcher();
    // Create and dispatch custom event "nodeSizing"
    // const sizeEvent = new Event('nodeSizing');
    // document.dispatchEvent(sizeEvent);
}

//////////////////////////////// DISPATCHER ////////////////////////////////
let categoryCounts;
function dispatcher() {
    const nodeGroups = document.querySelectorAll('.node-group');
    const links = document.querySelectorAll('.link');
    categoryCounts = [0, 0, 0, 0]; 

    nodeGroups.forEach(node => {
        nodeGestion (node);
    }) 
    links.forEach(link => {
        if(link.getAttribute('multiverse') !== "true"){
            linkGestion (link);
        }        
    });
    navigationLabels(categoryCounts);
}

function nodeGestion (node) {
    const category = isOnScreen(node);   
    if (category !== 4) {
        node.style.display = 'none'; 
        if (node.getAttribute('type') === 'video') {
            pauseVideoIfOutOfViewport(parseInt(node.getAttribute('id').match(/\d+/)[0], 10));
        } 
        categoryCounts[category]++;    
    } else {
        node.style.display = 'block';        
    }
}

function linkGestion (link) {
    const node1 = document.getElementById(link.getAttribute('Node1'));
    const node2 = document.getElementById(link.getAttribute('Node2'));

    if (isOnScreen(node1) !== 4 && isOnScreen(node2) !== 4 && !lineIsOnScreen(node1, node2)) {
        link.style.display = 'none';
    } else if (linkState !== 2) {
        link.style.display = 'block';
    }
}

// Check if node is visible on the screen
function isOnScreen (node) {    
    const screenX = - Math.round(-parseFloat(node.getAttribute('x'))*currentZoom - centerX + parseFloat(root.getAttribute('x')));
    const screenY = - Math.round(parseFloat(node.getAttribute('y'))*currentZoom - centerY - parseFloat(root.getAttribute('y')));
    const r = parseFloat(node.children[1].getAttribute('r'))*currentZoom;
    if (((screenX + r < 0 && screenY < window.innerHeight/2) || (screenY + r < 0 && screenX < window.innerWidth/2))) {
        return 0; // Top-left
    } else if (((screenX - r > window.innerWidth && screenY <= window.innerHeight/2) || (screenY + r < 0 && screenX >= window.innerWidth/2))) {
        return 1; // Top-right
    } else if (((screenX + r < 0 && screenY >=  window.innerHeight/2) || (screenY - r > window.innerHeight && screenX <= window.innerWidth/2))) {
        return 2; // Bottom-left
    } else if (((screenX - r > window.innerWidth && screenY >=  window.innerHeight/2) || (screenY - r > window.innerHeight && screenX > window.innerWidth/2))) {
        return 3; // Bottom-right
    } else {
        return 4;
    }  
}

// Check if any part of the link is visible on the screen
function lineIsOnScreen(node1, node2) {
    const x1 = - Math.round(-parseFloat(node1.getAttribute('x')) * currentZoom - window.innerWidth/2 + parseFloat(root.getAttribute('x')));
    const y1 = - Math.round(parseFloat(node1.getAttribute('y')) * currentZoom - window.innerHeight/2 - parseFloat(root.getAttribute('y')));
    const x2 = - Math.round(-parseFloat(node2.getAttribute('x')) * currentZoom - window.innerWidth/2 + parseFloat(root.getAttribute('x')));
    const y2 = - Math.round(parseFloat(node2.getAttribute('y')) * currentZoom - window.innerHeight/2 - parseFloat(root.getAttribute('y')));
    
    // Get screen boundaries
    const screenLeft = 0;
    const screenRight = window.innerWidth;
    const screenTop = 0;
    const screenBottom = window.innerHeight;

    // Check if the line between (x1, y1) and (x2, y2) intersects the screen
    return lineIntersectsScreen(x1, y1, x2, y2, screenLeft, screenTop, screenRight, screenBottom);
}

function lineIntersectsScreen(x1, y1, x2, y2, left, top, right, bottom) {
    // Simple bounding box check to see if the line is within the screen boundaries
    const lineMinX = Math.min(x1, x2);
    const lineMaxX = Math.max(x1, x2);
    const lineMinY = Math.min(y1, y2);
    const lineMaxY = Math.max(y1, y2);

    // Check if the bounding box of the line overlaps with the screen
    if (lineMaxX < left || lineMinX > right || lineMaxY < top || lineMinY > bottom) {
        return false;
    }

    return true; // Part of the line is on screen
}

