//////////////////// PERFORMING A ZOOM ////////////////////

const defaultZoom = 1;
let currentZoom = defaultZoom;
let prevZoom;
const zoomStep = 0.95; 
let isZooming = false;
// Pincement du trackpad (Ctrl + molette envoyé par le navigateur, des dizaines d'événements par geste) : un mouvement
// continu, image par image. Tant que des événements arrivent, le zoom avance d'un pas de PINCH_STEP à chaque image,
// dans le sens du dernier événement, quel que soit leur nombre ; une image sans événement l'arrête net.
const PINCH_STEP = 0.98;  // 2 % par image : environ ×3 par seconde de pincement soutenu
let pinchEvent = null, pinchFrame = 0;
function pinchTick() {
    if (!pinchEvent) { pinchFrame = 0; return; }  // aucun événement depuis l'image précédente : le geste s'est arrêté
    zoom(pinchEvent, 1, PINCH_STEP);
    sizeCurrent();
    pinchEvent = null;
    pinchFrame = requestAnimationFrame(pinchTick);
}

// Event listener for the wheel event (pinch-to-zoom)
svg.addEventListener('wheel', function(event) { 
    if (!event.ctrlKey && scrollsInside(event)) return;  // un contenu défilant dans un node (sortie, aperçu) défile
    event.preventDefault(); 
    const deltaY = event.deltaY;
    const deltaX = event.deltaX;

    const mouse = mouseWheel(event);
    // Un pincement (Ctrl + molette du navigateur) zoome même à deltaY entier, comme sous Windows
    if (deltaY === Math.round(deltaY) && (!mouse || event.shiftKey) && !(event.ctrlKey && event.isTrusted)) {
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
                pinchEvent = { deltaY };
                if (!pinchFrame) pinchTick();  // première image du geste tout de suite, les suivantes à chaque image
                return;  // la taille du node courant suit à chaque image (pinchTick)
            } else {
                const steps = mouse ? Math.min(4, Math.max(1, Math.round(event.deltaMode === 1 ? Math.abs(deltaY) : Math.abs(deltaY) / 40))) : 1;
                zoom(event, steps);
            }
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

// count : pas appliqués d'un coup (même zoom, mêmes arrondis qu'autant d'appels) ; la vue ne se déplace et les nodes à
// l'écran ne se recalculent qu'une fois, au lieu d'une fois par pas. step : taille d'un pas (zoomStep, ou PINCH_STEP).
function zoom(event, count = 1, step = zoomStep) {  
    // Get the delta value to determine the direction of the scroll (positive for zooming out, negative for zooming in)
    const delta = event.deltaY || event.detail || event.wheelDelta;
    const zoomOut = delta > 0;    
    const minZoom = (defaultZoom * Math.pow(zoomStep, 50)).toFixed(2); 
    const maxZoom = (defaultZoom / Math.pow(zoomStep, 42)).toFixed(2);   
    // areaWidth = window.innerWidth;
    // areaHeight = window.innerHeight; 

    var prev = currentZoom;
    for (let i = 0; i < count; i++) {
        if (zoomOut) {
            currentZoom = Math.max(minZoom, currentZoom * step).toFixed(3); // Decrease the zoom level for zooming out
        } else {
            currentZoom = Math.min(maxZoom, currentZoom / step).toFixed(3); // Increase the zoom level for zooming in 
        }
    }
    
    dragUniverse(parseFloat((-centerX)*(currentZoom - prev)),parseFloat((-centerY)*(currentZoom - prev)),false,'zoom');  // sans dispatcher : le second appel le passe
    dragUniverse(parseFloat((-zoomX)*(currentZoom - prev)),parseFloat((zoomY)*(currentZoom - prev)),false,'');  
}   

