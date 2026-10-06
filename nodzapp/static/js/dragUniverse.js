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
    // (the first half of a zoom step skips it: the second half dispatches once for both)
    if (zoom !== 'zoom') dispatcher();
    // Create and dispatch custom event "nodeSizing"
    // const sizeEvent = new Event('nodeSizing');
    // document.dispatchEvent(sizeEvent);
}

//////////////////////////////// DISPATCHER ////////////////////////////////
let categoryCounts;
function dispatcher() {
    const nodeGroups = document.querySelectorAll('.node-group');
    const links = document.querySelectorAll('.link');
    const view = viewOf();
    const categories = new Map();  // category of each node, computed once per pass and reused by its links
    categoryCounts = [0, 0, 0, 0]; 

    nodeGroups.forEach(node => {
        nodeGestion (node, view, categories);
    }) 
    links.forEach(link => {
        if(link.getAttribute('multiverse') !== "true"){
            linkGestion (link, view, categories);
        }        
    });
    navigationLabels(categoryCounts);
}

// Only a changed value is written: an unchanged write still costs a style pass on 1000 nodes
function setDisplay (element, value) {
    if (element.style.display !== value) element.style.display = value;
}

function nodeGestion (node, view, categories) {
    const category = isOnScreen(node, view);   
    if (!categories.has(node.id)) categories.set(node.id, category);
    if (category !== 4) {
        setDisplay(node, 'none'); 
        categoryCounts[category]++;    
    } else {
        setDisplay(node, 'block');        
    }
}

function linkGestion (link, view, categories) {
    const id1 = link.getAttribute('Node1');
    const id2 = link.getAttribute('Node2');
    const category = id => categories.has(id) ? categories.get(id) : isOnScreen(document.getElementById(id), view);

    if (category(id1) !== 4 && category(id2) !== 4 && !lineIsOnScreen(document.getElementById(id1), document.getElementById(id2))) {
        setDisplay(link, 'none');
    } else if (linkState !== 2) {
        setDisplay(link, 'block');
    }
}

// Screen frame, read once per dispatcher pass instead of once per node
function viewOf () {
    return { rootX: parseFloat(root.getAttribute('x')), rootY: parseFloat(root.getAttribute('y')), width: window.innerWidth, height: window.innerHeight };
}

// Check if node is visible on the screen
function isOnScreen (node, view = viewOf()) {    
    const screenX = - Math.round(-parseFloat(node.getAttribute('x'))*currentZoom - centerX + view.rootX);
    const screenY = - Math.round(parseFloat(node.getAttribute('y'))*currentZoom - centerY - view.rootY);
    const r = parseFloat(node.children[1].getAttribute('r'))*currentZoom;
    if (((screenX + r < 0 && screenY < view.height/2) || (screenY + r < 0 && screenX < view.width/2))) {
        return 0; // Top-left
    } else if (((screenX - r > view.width && screenY <= view.height/2) || (screenY + r < 0 && screenX >= view.width/2))) {
        return 1; // Top-right
    } else if (((screenX + r < 0 && screenY >=  view.height/2) || (screenY - r > view.height && screenX <= view.width/2))) {
        return 2; // Bottom-left
    } else if (((screenX - r > view.width && screenY >=  view.height/2) || (screenY - r > view.height && screenX > view.width/2))) {
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

