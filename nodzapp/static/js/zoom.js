//////////////////// PERFORMING A ZOOM ////////////////////

const defaultZoom = 1;
let currentZoom = defaultZoom;
let prevZoom;
const zoomStep = 0.95; 
let isZooming = false;
// Pincement du trackpad (Ctrl + molette envoyé par le navigateur, parfois une centaine d'événements par geste) : les
// événements d'une même image sont comptés puis traités en un seul appel de zoom, juste avant l'image (même amplitude,
// un pas par événement, mais un seul déplacement de la vue et un seul calcul des nodes à l'écran par image).
let pinchSteps = 0, pinchFrame = 0;
function flushPinch() {
    pinchFrame = 0;
    const steps = pinchSteps;
    pinchSteps = 0;
    if (!steps) return;
    zoom({ deltaY: steps }, Math.abs(steps));
    if (window.dispatcherNow) dispatcherNow();  // les nodes qui entrent à l'écran s'affichent dans cette image-ci
    sizeCurrent();
}

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
            // A mouse notch zooms several steps at once, a pinch one step per event
            if (event.ctrlKey && event.isTrusted) {
                pinchSteps += deltaY > 0 ? 1 : -1;
                if (!pinchFrame) pinchFrame = requestAnimationFrame(flushPinch);
                return;  // le zoom, et la taille du node courant, se font au traitement du lot
            }
            const steps = mouse ? Math.min(4, Math.max(1, Math.round(event.deltaMode === 1 ? Math.abs(deltaY) : Math.abs(deltaY) / 40))) : 1;
            for (let i = 0; i < steps; i++) zoom(event);
        } else {
            event.stopPropagation();
        }     
    }
    sizeCurrent();
});

function sizeCurrent() {
    if(currentNode){
        var r = parseFloat(currentNode.children[1].getAttribute('r'));
        r = Math.sqrt(2*r*r);
        nodeSizing(currentNode,r,r);
    }
}

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

function zoom(event, count = 1) {  // count : pas appliqués d'un coup (un lot de pincement)
    // Get the delta value to determine the direction of the scroll (positive for zooming out, negative for zooming in)
    const delta = event.deltaY || event.detail || event.wheelDelta;
    const zoomOut = delta > 0;    
    const minZoom = (defaultZoom * Math.pow(zoomStep, 50)).toFixed(2); 
    const maxZoom = (defaultZoom / Math.pow(zoomStep, 42)).toFixed(2);   
    // areaWidth = window.innerWidth;
    // areaHeight = window.innerHeight; 

    var prev = currentZoom;
    for (let i = 0; i < count; i++) {  // pas par pas, arrondis compris : le même zoom qu'autant d'appels
        if (zoomOut) {
            currentZoom = Math.max(minZoom, currentZoom * zoomStep).toFixed(3); // Decrease the zoom level for zooming out
        } else {
            currentZoom = Math.min(maxZoom, currentZoom / zoomStep).toFixed(3); // Increase the zoom level for zooming in 
        }
    }
    
    dragUniverse(parseFloat((-centerX)*(currentZoom - prev)),parseFloat((-centerY)*(currentZoom - prev)),false,'zoom');
    dragUniverse(parseFloat((-zoomX)*(currentZoom - prev)),parseFloat((zoomY)*(currentZoom - prev)),false,'');  
}   

