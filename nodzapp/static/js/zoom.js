//////////////////// PERFORMING A ZOOM ////////////////////

const defaultZoom = 1;
let currentZoom = defaultZoom;
let prevZoom;
const zoomStep = 0.95; 
let isZooming = false;
let zoomPending = 0, zoomFrame = 0;  // pas de zoom en attente de l'image suivante (signés : positif = recul)

// Event listener for the wheel event (pinch-to-zoom)
svg.addEventListener('wheel', function(event) { 
    if (!event.ctrlKey && scrollsInside(event)) return;  // un contenu défilant dans un node (sortie, aperçu) défile
    event.preventDefault(); 
    const deltaY = event.deltaY;
    const deltaX = event.deltaX;

    const mouse = mouseWheel(event);
    if (deltaY === Math.round(deltaY) && (!mouse || event.shiftKey)) {
        // Two-finger movement detected (or Shift + mouse wheel)
        dragUniverse(-deltaX,-deltaY,false)
         
    } else {        
        // Pinch zoom detected, or a mouse wheel notch
        if(!isCtrlPressed && !preview){
            if(!isZooming) {
                areaWidth = window.innerWidth;
                areaHeight = window.innerHeight;             
                zoomX = Math.round((event.clientX - centerX) + parseFloat(root.getAttribute('x')))/currentZoom;
                zoomY = -Math.round((event.clientY - centerY) - parseFloat(root.getAttribute('y')))/currentZoom;    
                isZooming = true;
            }  
            // Un cran de souris zoome de plusieurs pas, un pincement d'un pas par événement ; les pas reçus pendant
            // une image s'appliquent d'un seul coup (un pincement envoie plusieurs événements par image). Les molettes
            // simulées (Tab, aperçu de fichier) zooment tout de suite : leurs boucles attendent le nouveau zoom.
            const steps = mouse ? Math.min(4, Math.max(1, Math.round(event.deltaMode === 1 ? Math.abs(deltaY) : Math.abs(deltaY) / 30))) : 1;
            if (!event.isTrusted) {
                zoom(event, steps);
            } else {
                zoomPending += deltaY > 0 ? steps : -steps;
                if (!zoomFrame) zoomFrame = requestAnimationFrame(() => {
                    const n = zoomPending;
                    zoomPending = zoomFrame = 0;
                    if (n) zoom({ deltaY: n }, Math.abs(n));
                });
            }
        } else {
            event.stopPropagation();
        }     
    }
    if(currentNode){
        var r = parseFloat(currentNode.children[1].getAttribute('r'));
        r = Math.sqrt(2*r*r);
        nodeSizing(currentNode,r,r);
    }
});

// Un élément HTML défilant sous le pointeur, entre lui et l'univers, qui peut encore défiler dans ce sens ?
function scrollsInside(event) {
    for (let el = event.target; el && el !== svg; el = el.parentNode) {
        if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 1) continue;
        const overflow = getComputedStyle(el).overflowY;
        if (overflow !== 'auto' && overflow !== 'scroll') continue;
        if (event.deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
    }
    return false;
}

// A mouse wheel (notches) rather than a touchpad: lines in Firefox, multiples of 120 in Chrome and Safari,
// except the Mac touchpad signature (wheelDeltaY = -3 x deltaY)
function mouseWheel(event) {
    if (event.deltaMode === 1) return true;
    const notch = event.wheelDeltaY;
    return !event.deltaX && !!notch && notch % 120 === 0 && notch !== -3 * event.deltaY;
}

function zoom(event, steps = 1) {  
    // Get the delta value to determine the direction of the scroll (positive for zooming out, negative for zooming in)
    const delta = event.deltaY || event.detail || event.wheelDelta;
    const zoomOut = delta > 0;    
    const minZoom = (defaultZoom * Math.pow(zoomStep, 50)).toFixed(2); 
    const maxZoom = (defaultZoom / Math.pow(zoomStep, 42)).toFixed(2);   
    // areaWidth = window.innerWidth;
    // areaHeight = window.innerHeight; 

    var prev = currentZoom;
    for (let i = 0; i < steps; i++) {  // pas par pas, arrondis compris : le même zoom qu'autant d'appels
        if (zoomOut) {
            currentZoom = Math.max(minZoom, currentZoom * zoomStep).toFixed(3); // Decrease the zoom level for zooming out
        } else {
            currentZoom = Math.min(maxZoom, currentZoom / zoomStep).toFixed(3); // Increase the zoom level for zooming in 
        }
    }
    
    dragUniverse(parseFloat((-centerX)*(currentZoom - prev)),parseFloat((-centerY)*(currentZoom - prev)),false,'zoom');
    dragUniverse(parseFloat((-zoomX)*(currentZoom - prev)),parseFloat((zoomY)*(currentZoom - prev)),false,'');  
}   

