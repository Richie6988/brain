//////////////////// PERFORMING A ZOOM ////////////////////

const defaultZoom = 1;
let currentZoom = defaultZoom;
let prevZoom;
const zoomStep = 0.95; 
const minZoom = (defaultZoom * Math.pow(zoomStep, 50)).toFixed(2);
const maxZoom = (defaultZoom / Math.pow(zoomStep, 42)).toFixed(2);
// Pincement du trackpad (Ctrl + molette envoyé par le navigateur) : PINCH_LEVELS niveaux de zoom, du plus loin au plus
// près ; un geste de pincement passe au niveau suivant en PINCH_GLIDE ms (peu de calculs, rendu fluide). Le reste du geste
// est ignoré : un geste se termine après PINCH_GAP ms sans événement, et un événement en retard de plus de PINCH_LATE ms
// ne compte pas (le zoom s'arrête avec le geste).
const PINCH_LEVELS = 10;
const PINCH_GLIDE = 200;
const PINCH_GAP = 150;
const PINCH_LATE = 100;
let pinchLast = 0;  // heure du dernier événement de pincement (fin de geste après PINCH_GAP ms sans lui)
const pinchLevels = Array.from({ length: PINCH_LEVELS }, (_, i) => minZoom * Math.pow(maxZoom / minZoom, i / (PINCH_LEVELS - 1)));
let pinchBusy = false;  // un glissé de niveau accepté et pas encore affiché : les autres événements sont ignorés
let isZooming = false;

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
                const fresh = event.timeStamp - pinchLast > PINCH_GAP;  // premier événement d'un nouveau geste
                pinchLast = event.timeStamp;
                if (fresh && !pinchBusy && performance.now() - event.timeStamp <= PINCH_LATE) pinchLevel(deltaY > 0 ? -1 : 1);
            } else {
                const steps = mouse ? Math.min(4, Math.max(1, Math.round(event.deltaMode === 1 ? Math.abs(deltaY) : Math.abs(deltaY) / 40))) : 1;
                for (let i = 0; i < steps; i++) zoom(event);
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

// Glisse jusqu'au niveau de pincement voisin (direction 1 : plus près, -1 : plus loin), autour du même point que zoom().
function pinchLevel(direction) {
    const now = Number(currentZoom);
    // Un niveau à moins de 15 % du zoom actuel est sauté : chaque geste se voit.
    const target = direction > 0 ? pinchLevels.find(level => level > now * 1.15) : [...pinchLevels].reverse().find(level => level < now / 1.15);
    if (!target) return;
    pinchBusy = true;
    const start = performance.now();
    requestAnimationFrame(function glide(time) {
        const k = Math.min(1, (time - start) / PINCH_GLIDE), eased = 1 - (1 - k) ** 3;
        const prev = currentZoom;
        currentZoom = (now * Math.pow(target / now, eased)).toFixed(4);
        moveZoom(prev);
        if (k < 1) requestAnimationFrame(glide);
        else setTimeout(() => { pinchBusy = false; });  // libre une fois la dernière image affichée
    });
}

function zoom(event) {  
    // Get the delta value to determine the direction of the scroll (positive for zooming out, negative for zooming in)
    const delta = event.deltaY || event.detail || event.wheelDelta;
    const zoomOut = delta > 0;    
    // areaWidth = window.innerWidth;
    // areaHeight = window.innerHeight; 

    var prev = currentZoom;
    if (zoomOut) {
        currentZoom = Math.max(minZoom, currentZoom * zoomStep).toFixed(3); // Decrease the zoom level for zooming out
    } else {
        currentZoom = Math.min(maxZoom, currentZoom / zoomStep).toFixed(3); // Increase the zoom level for zooming in 
    }
    moveZoom(prev);
}

// La vue suit le nouveau zoom autour du point fixe (zoomX, zoomY).
function moveZoom(prev) {
    dragUniverse(parseFloat((-centerX)*(currentZoom - prev)),parseFloat((-centerY)*(currentZoom - prev)),false,'zoom');
    dragUniverse(parseFloat((-zoomX)*(currentZoom - prev)),parseFloat((zoomY)*(currentZoom - prev)),false,'');  
}   

