const resizeObservers = new Map();
var isRotating = false;
let lastTimer = 0;

function init(geom,fileContainer) {
    var container = document.createElement('div');
    container.className = 'stlcontainer';
    const match = fileContainer.id.match(/\d+/);
    const number = match ? parseInt(match[0]) : null; 
    container.id = `stlContainer-${number}`
    container.style.width = '100%';
    container.style.height = '100%';
    fileContainer.appendChild(container);

    // Set the desired camera parameters
    const fov = 65; // Field of view
    const aspectRatio = 1; // Aspect ratio based on container dimensions
    const near = 0.1; // Near clipping plane
    const far = 1000; // Far clipping plane
    const zoom = Math.min(fileContainer.clientWidth, fileContainer.clientHeight) / 100;

    // Create the camera with the calculated parameters
    var camera = new THREE.PerspectiveCamera(fov, aspectRatio, near, far);
    camera.position.set(3, 0.15, 0);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();

    // Set the camera target
    var cameraTarget = new THREE.Vector3(0, 0, 0);

    var scene = new THREE.Scene();
    // scene.background = new THREE.Color(0x050c17);
    // scene.fog = new THREE.Fog(0x050c17, 2, 15);

    // var plane = new THREE.Mesh(
    //     new THREE.PlaneBufferGeometry(40, 40),
    //     new THREE.MeshPhongMaterial({ color: 0x1ad4a2, specular: 0x101010 })
    // );
    // plane.name = 'plane'
    // plane.rotation.x = -Math.PI / 2;
    // plane.position.y = -0.5;
    // scene.add(plane);
    // plane.receiveShadow = true;

    var material = new THREE.MeshPhongMaterial({ color: 0xb89af2, specular: 0x111111, shininess: 200 });
   
    var obj = new THREE.Mesh(geom, material);
    obj.name = 'loadedFile'                
    obj.position.set(0, -0.5, 0);
    // Calculate Object Size
    const objSize = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    var factor = Math.max(objSize.x,objSize.y,objSize.z);
    if(objSize.x>objSize.y){
        obj.rotation.set(-Math.PI / 4, 0, 0);
    } else {
        obj.rotation.set(0, -Math.PI / 2, 0);
    }
    

    factor = (1/factor).toFixed(3);
    obj.scale.set(factor, factor, factor);
    // obj.castShadow = true;
    obj.receiveShadow = true;

    scene.add(new THREE.HemisphereLight(0x443333, 0x111122));

    addShadowedLight(scene,1, 1, 1, 0xffffff, 1.35);
    addShadowedLight(scene,0.5, 1, -1, 0xffaa00, 1);

    var renderer = new THREE.WebGLRenderer({alpha: true, antialias: true });
    renderer.setClearColor( 0x000000, 0 );
    renderer.customAttribute = true;
    renderer.id = `renderer-${number}`
    renderer.setPixelRatio(1);
    renderer.setSize(fileContainer.clientWidth, fileContainer.clientHeight);
    renderer.gammaInput = true;
    renderer.gammaOutput = true;
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
 
    window.addEventListener('resize', function() {
        onWindowResize(camera, renderer);
    }, false);  
   
    scene.add(obj);

    const resizeObserver = new ResizeObserver(() => {
        let ancestor = container.parentElement.parentElement.parentElement;

        // Check if container is on screen and the observer should proceed
        if (isOnScreen(ancestor) !== 4) {
            // Stop rendering
            renderer.customAttribute = false;
            // console.log('stop');
        } else {
            // Render if on screen
            var x = handleResize(`stlContainer-${number}`);
            onWindowResize(camera, renderer, x);
            renderer.customAttribute = true;
            render(camera, cameraTarget, renderer, scene);
            // console.log('play');
        }
    });
    // Store observer in the map
    resizeObservers.set(number, resizeObserver);
    // Start observing
    resizeObserver.observe(container);
     
    render(camera, cameraTarget, renderer, scene);

    var stlDragX, stlDragY, stlInitialdragX, stlInitialdragY = 0;
    container.addEventListener('mousedown', function(event) {
        event.preventDefault();
        isRotating = true;
        stlInitialdragX = event.clientX;
        stlInitialdragY = event.clientY;
    });
    svg.addEventListener('mousemove', function(event) {
        if (isRotating) {
            event.preventDefault();
            svg.style.cursor = 'grabbing';
            stlDragX = event.clientX - stlInitialdragX;
            stlDragY = event.clientY - stlInitialdragY;
            stlInitialdragX = event.clientX;
            stlInitialdragY = event.clientY;
            // Apply rotation based on drag movement
            obj.rotation.y += stlDragX * 0.01; // Adjust sensitivity
            obj.rotation.x -= stlDragY * 0.01; // Adjust sensitivity                       
        }
    });    
    svg.addEventListener('mouseup', function() {
        if (isRotating) {
            svg.style.cursor = 'crosshair';         
            isRotating = false; 
            render(camera, cameraTarget, renderer, scene);   
        }  
    });
}

function handleResize(id) {    
    const cont = document.getElementById(id);
    const rendererElement = cont.querySelector("canvas");
    rendererElement.style.width = '100%';
    rendererElement.style.height = '100%';
    const computedStyle = window.getComputedStyle(rendererElement);
    const width = parseInt(computedStyle.getPropertyValue("width"), 10);
    return width
}


function addShadowedLight(scene, x, y, z, color, intensity) {
    var directionalLight = new THREE.DirectionalLight(color, intensity);
    directionalLight.position.set(x, y, z);
    scene.add(directionalLight);
    directionalLight.castShadow = true;
    var d = 1;
    directionalLight.shadow.camera.left = -d;
    directionalLight.shadow.camera.right = d;
    directionalLight.shadow.camera.top = d;
    directionalLight.shadow.camera.bottom = -d;
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 4;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.bias = -0.002;
}

function onWindowResize(camera, renderer, x) {
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    renderer.setSize(x, x);
}


function render(camera, cameraTarget, renderer, scene) {
    requestAnimationFrame(function() {
        render(camera, cameraTarget, renderer, scene); 
    });
   if(renderer.customAttribute && !isRotating){       
        lastTimer += 0.0025;
        camera.position.x = Math.cos(lastTimer) * 3;
        camera.position.z = Math.sin(lastTimer) * 3;
        camera.lookAt(cameraTarget);
    }  
    renderer.render(scene, camera); 
}

var openFile = function (file,fileContainer) {
        var reader = new FileReader();
        reader.addEventListener("load", function (ev) {
            var buffer = ev.target.result;            
            var geom = loadBinaryStl(buffer);   
            const match = fileContainer.id.match(/\d+/);
            const number = match ? parseInt(match[0]) : null; 
       
            if (document.getElementById(`stlContainer-${number}`)) {
                console.log(document.getElementById(`stlContainer-${number}`).parentNode)
                document.getElementById(`stlContainer-${number}`).parentNode.removeChild(document.getElementById(`stlContainer-${number}`));
            } 
            init(geom,fileContainer);
                       
        }, false);
        reader.readAsArrayBuffer(file);
    };


var loadBinaryStl = function (buffer) {
    // binary STL
    var view = new DataView(buffer);
    var size = view.getUint32(80, true);
    var geom = new THREE.Geometry();
    var offset = 84;
    for (var i = 0; i < size; i++) {
        var normal = binaryVector3(view, offset);
        geom.vertices.push(binaryVector3(view, offset + 12));
        geom.vertices.push(binaryVector3(view, offset + 24));
        geom.vertices.push(binaryVector3(view, offset + 36));
        geom.faces.push(
            new THREE.Face3(i * 3, i * 3 + 1, i * 3 + 2, normal));
        offset += 4 * 3 * 4 + 2;
    }
    return geom;
};

var binaryVector3 = function (view, offset) {
    var v = new THREE.Vector3();
    v.x = view.getFloat32(offset + 0, true);
    v.y = view.getFloat32(offset + 4, true);
    v.z = view.getFloat32(offset + 8, true);
    return v;
};
    
