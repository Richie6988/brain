
//////////////////// BUTTON CONTAINER ////////////////////

const buttonContainer = document.getElementById("button-container");
const indicator = document.getElementById("indicator");


document.addEventListener("mousemove", function() {
  const windowHeight = window.innerHeight;
  const windowWidth = window.innerWidth;
  const threshold = 100; 

  if (mouseY > windowHeight - threshold && mouseX > 90 && mouseX < windowWidth - 90 && !isDragging && !isTyping && !overlay) {
    buttonContainer.classList.add("show");
    indicator.style.backgroundColor = 'transparent'; 

  } else if (document.getElementById('semanticsearch') !== document.activeElement){
    buttonContainer.classList.remove("show");
    if(dark) {    
        indicator.style.backgroundColor = '#a553b9c0';   
    } else {
        indicator.style.backgroundColor = '#53aab9c0';   
    }
  }
});


document.getElementById('button-container').addEventListener('wheel', function(event) {
    event.preventDefault();
    zoom(event);    
});

document.getElementById('button-container').addEventListener('mouseout', function(event) { 
    deleteTooltip();
});

document.getElementById('button-container').addEventListener('mousedown', function(event) {
    if(!document.getElementById('semanticsearch').contains(event.target)){
        event.preventDefault();
    }
});

document.getElementById('brand-container').addEventListener('mousedown', function(event) {
    event.preventDefault();
});

document.getElementById('brand-container').addEventListener('mouseover', function(event) {
    if(this.style.left !== '0%'){
        this.style.left = '0%';
    } else {
        this.style.left = 'calc(100% - 200px)';
    }    
});


document.getElementById('button-container').addEventListener('mouseover', function() {
    if (!isLoggedIn) {
        // Disabling click action
        document.getElementById('templateButton').disabled = true;
        document.getElementById('soundButton').disabled = true;
        document.getElementById('darkButton').disabled = true;
        document.getElementById('fullscreenButton').disabled = true;
        document.getElementById('linksButton').disabled = true;
        document.getElementById('flagButton').disabled = true;
        document.getElementById('originButton').disabled = true;
        document.getElementById('shareButton').disabled = true;
        document.getElementById('exportButton').disabled = true;
        document.getElementById('notificationButton').disabled = true;
        document.getElementById('profileButton').disabled = true;       
    }
});

// Adding event listener for mouseout event
document.getElementById('button-container').addEventListener('mouseout', function() {
    // Enabling click action when mouse leaves the button container
    document.getElementById('templateButton').disabled = false;
    document.getElementById('soundButton').disabled = false;
    document.getElementById('darkButton').disabled = false;
    document.getElementById('fullscreenButton').disabled = false;
    document.getElementById('linksButton').disabled = false;
    document.getElementById('flagButton').disabled = false;
    document.getElementById('originButton').disabled = false;
    document.getElementById('shareButton').disabled = false;
    document.getElementById('exportButton').disabled = false;
    document.getElementById('notificationButton').disabled = false;
    document.getElementById('profileButton').disabled = false; 
});


//////////////////// BUTTON FOR LINKS GESTION 


// Display of links

let linkState = 0;
var styleElement = document.createElement('style');
styleElement.id = 'linksButton-style';
document.head.appendChild(styleElement);
styleElement.textContent = `
#linksButton::after {
    background: url('${NODZ_BASE}/static/img/gradlink.svg') no-repeat center/cover;
    background-size: 90%;
}`;

document.getElementById('linksButton').addEventListener('click', function() {
    const styleElement = document.getElementById('linksButton-style');
    const links = document.querySelectorAll('.link');
    deleteTooltip();

    if (linkState === 0){
        styleElement.textContent = `
        #linksButton::after {
            background: url('${NODZ_BASE}/static/img/link.svg') no-repeat center/cover;
            background-size: 90%;
        }`;

        links.forEach(link => {
            let gradientID = 'grad' + link.getAttribute('id');
            let gradient = document.getElementById(gradientID);
            if (gradient) {
                gradient.style.display = 'none';
            }  
          
            link.style.stroke = '#379be7';   
        });

        linkState = 1;
    } else if (linkState === 1){
        styleElement.textContent = `
        #linksButton::after {
            background: url('${NODZ_BASE}/static/img/nolink.svg') no-repeat center/cover;
            background-size: 90%;
        }`;

        links.forEach(link => {  
            link.style.display = 'none';
        });
        linkState = 2;
    } else {
        styleElement.textContent = `
        #linksButton::after {
            background: url('${NODZ_BASE}/static/img/gradlink.svg') no-repeat center/cover;
            background-size: 90%;
        }`;

        links.forEach(link => {
            link.style.display = 'block';
            let gradientID = 'grad' + link.getAttribute('id');
            let gradient = document.getElementById(gradientID);
            if (gradient) {
                gradient.style.display = 'block';
            }   
            updateLinkColor(link);          
        });

        linkState = 0;
    }
    var mouseOverEvent = new MouseEvent("mouseover", {
        bubbles: true, // Event bubbles up through the DOM
        cancelable: true, // Event can be canceled
        view: window, // Event view
    });
    
    // Dispatch the mouseover event to the target element
    document.getElementById('linksButton').dispatchEvent(mouseOverEvent);
});

document.getElementById('linksButton').addEventListener('mouseover', function(event) {
    if (linkState === 0){
        createTooltip ('linksButton','Styled link');
    } else if (linkState === 1){
        createTooltip ('linksButton','Neutral link');
    } else {
        createTooltip ('linksButton','No link');
    }
   
});


// Retour à l'origine : dans la dimension du drapeau d'abord (elle se charge), puis à ses coordonnées.
document.getElementById('originButton').addEventListener('click', function() {
    const home = () => dragUniverse(parseFloat(root.getAttribute('x'))-originX*currentZoom,-originY*currentZoom - parseFloat(root.getAttribute('y')));
    if (originLayer === null || Number(originLayer) === Number(layerNumber) || !layers.some(l => Number(l.id) === Number(originLayer))) {
        home();
        return;
    }
    load(Number(originLayer));
    const arrived = setInterval(() => {
        if (isLoading) return;
        clearInterval(arrived);
        home();
    }, 50);
});
document.getElementById('originButton').addEventListener('mouseover', function(event) {
    createTooltip ('originButton','Back to origin');
});


//// CONSTELLATION SELECTION

document.getElementById('layerButton').addEventListener('mouseover', function(event) {
    createTooltip ('layerButton','Dimensions');
});

//////////////////// FLAG ////////////////////

document.getElementById('flagButton').addEventListener('click', function() {
    originX = parseFloat(root.getAttribute('x'))/currentZoom;
    originY = - parseFloat(root.getAttribute('y'))/currentZoom;
    originLayer = layerNumber;

    placeFlag();

    // Drapeau de verre en 3D (comme le cube HYPERSPACE) planté au centre de l'écran, qui tourne puis s'efface.
    function placeFlag() {
        const flag = document.createElement('div');
        flag.className = 'origin-flag';
        flag.innerHTML = '<span class="of3"><i class="pole"></i><i class="pole"></i><b class="sail"><i></i><i></i></b></span><small>origine</small>';
        document.body.appendChild(flag);
        flag.addEventListener('animationend', event => { if (event.target === flag) flag.remove(); });
    }

});
document.getElementById('flagButton').addEventListener('mouseover', function(event) {
    createTooltip ('flagButton','Set new origin');
});

let fullscreen = false;
document.getElementById('fullscreenButton').addEventListener('click', function() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen({
            navigationUI: 'hide',
            keyboardInput: 'limited',
            autoHide: true,
            inline: false,
            displaySurface: 'fullscreen'
        }).catch(err => {
            console.error(`Error attempting to enable full-screen mode: ${err.message}`);
        });
        fullscreen = true;              
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
        fullscreen = false;
    }
});
document.getElementById('fullscreenButton').addEventListener('mouseover', function(event) {
    createTooltip ('fullscreenButton','Full screen');
});

//////////////////// TEMPLATE ////////////////////

document.getElementById('templateButton').addEventListener('mouseover', function() {    
    createTooltip ('templateButton','Template gallery');   
});


document.getElementById('templateButton').addEventListener('click', function() {
    const templates = document.getElementById('templates');
    templates.style.display = 'flex';
    templates.children[0].scrollTop = 0; 
    overlay = true;
    
    window.addEventListener('click', function(event) {
        if (event.target === templates) {
            templates.style.display = 'none';
            overlay = false;
        }
    });
});

//////////////////// SHARE/INVITE ////////////////////

document.getElementById('shareButton').addEventListener('mouseover', function() {
    createTooltip ('shareButton','Share');
});

document.getElementById('shareButton').addEventListener('click', function() {
    // var sharedIDs = [('userID',userID)]
    var sharedIDs = [];
    const nodeGroups = document.querySelectorAll('.node-group');
       nodeGroups.forEach(node => {
        if (node.getAttribute('privacy') !== 2){
            sharedIDs.push(parseInt(node.id.match(/\d+/)[0], 10));
        }        
    }) 
    generateInvite(sharedIDs);
});


function generateInvite(nodeIds) {
    fetch(`/generate_invite/${nodeIds.join(',')}/`)
        .then(response => response.json())
        .then(data => {
            if (data.invite_link) {
                let popup = document.createElement('div');
                popup.id = 'invitePopup'
                popup.className = 'popup'; 
                popup.style.height = 'auto';
            
                popup.addEventListener('contextmenu', (event) => {
                    event.preventDefault();
                });
            
                const message = document.createElement('div');
                message.className = 'smallmessage';   
                message.textContent = data.invite_link;
                popup.appendChild(message);
                const buttonContainer = document.createElement('div');
                buttonContainer.className = 'popupbutton-container'; 
                buttonContainer.style.justifyContent = 'center';
                const copyButton = document.createElement('span');
                copyButton.textContent = 'Copier le lien';
                copyButton.className = 'popupbutton confirm'; 
                copyButton.style.fontSize = '10px';
                copyButton.className = 'submit-button'; 
                copyButton.style.padding = '5px';
                buttonContainer.appendChild(copyButton);
                popup.appendChild(buttonContainer)
                document.body.appendChild(popup);
                
                copyButton.addEventListener('mousedown', function() {                                        
                    console.log(data.invite_link)
                    const inviteLink = data.invite_link;
                    // Use the Clipboard API if available for modern browsers
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(inviteLink).then(() => {
                            message.textContent = "Lien copié."; 
                            setTimeout(closePopup, 1000);
                        }).catch(err => {
                            console.error('Failed to copy text: ', err);
                        });
                    } else {  // page en http : pas d'API presse-papiers, copie par une zone de texte temporaire
                        const area = document.createElement('textarea');
                        area.value = inviteLink;
                        area.style.cssText = 'position:fixed;opacity:0';
                        document.body.appendChild(area);
                        area.select();
                        document.execCommand('copy');
                        area.remove();
                        message.textContent = "Lien copié.";
                        setTimeout(closePopup, 1000);
                    }
                });
                
                svg.addEventListener('mousedown', function(event) {
                    if (popup) {
                        closePopup();    
                    }
                });
                
                function closePopup() {
                    document.body.removeChild(popup);
                    popup = null;
                }
               
            } else {
                console.log("Failed to generate invite link.");
            }
        });
}


//////////////////// EXPORT ////////////////////

document.getElementById('exportButton').addEventListener('mouseover', function() {
    if(guestUser){
        createTooltip ('exportButton','Save');
    } else {
        createTooltip ('exportButton','Export');
    }    
});

document.getElementById('exportButton').addEventListener('mousedown', function() {
    // if(guestUser){
    //     login();
    //     document.getElementById('loginButton').click();
    // } else {
        const exportation = document.getElementById('export');
        exportation.style.display = 'flex';
        exportation.children[0].scrollTop = 0; 
        exportBtn.textContent = 'Exporter';
        nodesToExport = selectedNodes;
        templatesToExport = selectedTemplates

        if (selectedNodes.length === 0) {
            exportBtn.disabled = true;
        }
        
        window.addEventListener('click', function(event) {
            if (event.target === exportation) {
                exportation.style.display = 'none';
                if (extract){
                    document.body.removeChild(extract);
                    extract = null;
                }   
            }
        });
 
    // }   
      
});

//////////////////// COOKIES ////////////////////

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}


//////////////////// PROFILE ////////////////////

document.getElementById('profileButton').addEventListener('mouseover', function() {
    createTooltip ('profileButton','Profile');
});


document.getElementById('profileButton').addEventListener('mousedown', function() {
    const profile = document.getElementById('profile');
    profile.style.display = 'flex';
    overlay = true;
    getProfile();

    profile.addEventListener('mousedown', function(e) {
        const feedback = document.getElementById('feedback-input');
        const plan = document.getElementById('plan');
        const country = document.getElementById('country-select');

        if(feedback.contains(e.target) || plan.contains(e.target)){
            return;
        } else if (country &&  country.contains(e.target)){
            return;
        }
        else {
            e.preventDefault();
        }        
    })
    
    window.addEventListener('click', function(event) {
        if (event.target === profile) {
            profile.style.display = 'none';
            overlay = false;
            const existingPopup = document.querySelector('.mail-popup');
            if (existingPopup) {
                existingPopup.remove();
            }
        }
    });
});


//////////////////// PARAMS GRADIENT ////////////////////
// const defs = document.createElementNS("http://www.w3.org/2000/svg", 'defs');    
// // Create the radial gradient element
// const radialGradient = document.createElementNS("http://www.w3.org/2000/svg", 'radialGradient');
// radialGradient.setAttribute('id','paramsGradient');

// // Set gradient attributes (you can customize the spread method if needed)
// radialGradient.setAttribute('cx', '50%');  // Center X
// radialGradient.setAttribute('cy', '50%');  // Center Y
// radialGradient.setAttribute('r', '50%');   // Radius of the gradient

// const stop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
// stop1.setAttribute('id', 'stop1');
// const stop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
// stop2.setAttribute('id', 'stop2');
// const stop3 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
// stop3.setAttribute('id', 'stop3');
// const stop4 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
// stop4.setAttribute('id', 'stop4');

// // Append the stops to the gradient
// radialGradient.appendChild(stop1);
// radialGradient.appendChild(stop2);
// radialGradient.appendChild(stop3);
// radialGradient.appendChild(stop4);
// // Append the gradient definition to <defs>
// defs.appendChild(radialGradient);
// svg.appendChild(defs);

// function setParamsGradient() {
//     if(!dark){       
//         stop1.setAttribute('offset', '40%');
//         stop1.setAttribute('stop-color', 'rgba(240, 240, 240, 0.33)');  
//         stop2.setAttribute('offset', '40%');
//         stop2.setAttribute('stop-color', 'rgba(240, 240, 240, 1)');         
//         stop3.setAttribute('offset', '100%');
//         stop3.setAttribute('stop-color', 'rgba(240, 240, 240, 0.2)');       
//     } else {
//         stop1.setAttribute('offset', '40%');
//         stop1.setAttribute('stop-color',  'rgba(5, 12, 23, 0.33)');        
//         stop2.setAttribute('offset', '40%');
//         stop2.setAttribute('stop-color', 'rgba(5, 12, 23, 1)');       
//         stop3.setAttribute('offset', '100%');
//         stop3.setAttribute('stop-color', 'rgba(5, 12, 23, 0.2)');         
//     }
// }


//////////////////// DARK ////////////////////

let dark = true;
// Les barres d'outils des nodes sont gardées hors de la page (node.tools) : leurs images et leurs listes changent
// de thème avec le reste (Nodz lit la forme et le verrou d'un node dans le nom de ces images).
function themed(selector) {
    const tools = [...document.querySelectorAll('.node-group')].flatMap(n => Object.values(n.tools || {}).flatMap(g => [...g.querySelectorAll(selector)]));
    return [...new Set([...document.querySelectorAll(selector), ...tools])];
}
document.getElementById('darkButton').addEventListener('mouseover', function() {
    if (dark) {
        createTooltip ('darkButton','Dark');
    } else {
        createTooltip ('darkButton','Light');
    }
});

document.getElementById('darkButton').addEventListener('mousedown', function() {
    this.style.transform = this.style.transform === 'rotate(180deg)' ? 'rotate(0deg)' : 'rotate(180deg)';
    if (dark) {
        dark = false;
        const dropdowns = themed('.select-dropdown')
        layer.classList.add('lightmode');
        for (let i = 0; i < dropdowns.length; i++) {
            dropdowns[i].className = 'selectlight';       
        }

        const fourDs = document.querySelectorAll('.raydark')
        fourDs.forEach(node => {
            node.classList.remove('raydark');
            node.classList.add('raylight');
        });

        const colorLogo = themed('img');
        colorLogo.forEach(color => {
            if (color.getAttribute('src') === NODZ_BASE + '/static/img/colorpicking.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/colorpicking-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/bold.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/bold-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/italic.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/italic-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/underline.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/underline-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/smiley.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/smiley-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/view.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/view-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/unlock.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/unlock-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/edit.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/edit-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/calendar.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/calendar-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/lock.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/lock-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/layer.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/layer-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/newimg.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/newimg-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/undo.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/undo-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/redo.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/redo-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/eraser.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/eraser-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/eraseall.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/eraseall-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/circle.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/circle-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/square.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/square-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/line.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/line-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/upload.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/upload-light.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/download.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/download-light.svg');
            }
        });       
        
        const disks = document.querySelectorAll('.selectednode');
        disks.forEach(disk => {
            if(disk.style.fill !== 'none'){
                disk.style.fill = paramColorLight;
            } 
        });

        const names = document.querySelectorAll('.filename');
        names.forEach(name => {
            name.setAttribute('class', 'filename-light');
        });

        const triangles = document.querySelectorAll('.triangle');
        triangles.forEach(triangle => {
            triangle.setAttribute('class', 'triangle-light');
        });
        // const counters = document.querySelectorAll('.counter');
        // counters.forEach(counter => {
        //     counter.style.color = 'ivory';
        // });
        const tooltip = document.getElementById('tooltip');
        if(tooltip) {
            tooltip.style.fill = '#f0f0f0';
        }
    } else {
        dark = true;
        const dropdowns = themed('.selectlight')
        layer.classList.remove('lightmode');
        for (let i = 0; i < dropdowns.length; i++) {
            dropdowns[i].className = 'select-dropdown';  
        }

        const fourDs = document.querySelectorAll('.raylight')
        fourDs.forEach(node => {
            node.classList.remove('raylight');
            node.classList.add('raydark');
        });

        const colorLogo = themed('img');
        colorLogo.forEach(color => {
            if (color.getAttribute('src') === NODZ_BASE + '/static/img/colorpicking-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/colorpicking.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/bold-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/bold.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/italic-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/italic.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/underline-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/underline.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/smiley-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/smiley.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/view-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/view.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/unlock-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/unlock.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/edit-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/edit.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/calendar-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/calendar.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/lock-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/lock.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/layer-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/layer.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/newimg-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/newimg.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/undo-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/undo.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/redo-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/redo.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/eraser-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/eraser.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/eraseall-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/eraseall.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/circle-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/circle.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/square-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/square.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/line-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/line.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/upload-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/upload.svg');
            } else if (color.getAttribute('src') === NODZ_BASE + '/static/img/download-light.svg'){
                color.setAttribute('src', NODZ_BASE + '/static/img/download.svg');
            }
        });

        const disks = document.querySelectorAll('.selectednode');
        disks.forEach(disk => {
            if(disk.style.fill !== 'none'){
                disk.style.fill = paramColor;
            } 
        });

        const names = document.querySelectorAll('.filename-light');
        names.forEach(name => {
            name.setAttribute('class', 'filename');
        });

        const triangles = document.querySelectorAll('.triangle-light');
        triangles.forEach(triangle => {
            triangle.setAttribute('class', 'triangle');
        });
        // const counters = document.querySelectorAll('.counter');
        // counters.forEach(counter => {
        //     counter.style.color = 'grey';
        // });
        const tooltip = document.getElementById('tooltip');
        if(tooltip) {
            tooltip.style.fill = '#050c17';
        }
    }

    const canvasNodes = document.querySelectorAll('[id^="canvas-"]');
    canvasNodes.forEach(canvas => {
        
        var drawingDataString = canvas.parentElement.parentElement.getAttribute('canvascontent');
     
        try {
            drawingData = drawingDataString ? JSON.parse(drawingDataString) : [];
        } catch (error) {
            console.error('Error parsing JSON:', error);
            drawingData = []; // Default to empty object if parsing fails
        }
        redrawCanvas(canvas.getAttribute('id'),0, drawingData);
    });
});

let sound = false;
document.getElementById('soundButton').addEventListener('mouseover', function(event) {
    if(sound){
        createTooltip ('soundButton','Sound On');
    } else {
        createTooltip ('soundButton','Sound Off');
    }
    
});

document.getElementById('soundButton').addEventListener('mousedown', function(event) {
    var audio = document.getElementById('music');  
    if(sound){
        document.getElementById('soundButton').className = 'soundoff';
        sound = false;             
        audio.pause();
    } else {
        document.getElementById('soundButton').className = 'soundon';
        sound = true;
        audio.play();
    }
});

   /// BUTTON TOOLTIPS

   function createTooltip (id,text,event) {

    var button = document.getElementById(id);
    var buttonRect = button.getBoundingClientRect();
    if (buttonRect.width !== 0 && buttonRect.height !==0) {
        var btnX = buttonRect.left + buttonRect.width / 2;
        var btnY = buttonRect.top + buttonRect.height / 2;
    } else {
        var btnX = event.clientX;
        var btnY = event.clientY;
    }
    
    // Remove any existing tooltip before adding the updated one
    deleteTooltip();
  
    // Create or update the tooltip text element
    const tooltipText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tooltipText.setAttribute('class', 'tooltiptext'); 
    tooltipText.setAttribute('text-anchor', 'middle');
    tooltipText.setAttribute('x', btnX);

    // Split the text into two parts
    const [firstLine, secondLine] = text.split('\n');

    // Create first tspan for normal text
    const tspan1 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tspan1.setAttribute('x', btnX); // Center horizontally
    tspan1.setAttribute('dy', '0'); // No offset for the first line
    tspan1.textContent = firstLine;
    tooltipText.appendChild(tspan1);

    // Create second tspan for italic, smaller text
    const tspan2 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tspan2.setAttribute('x', btnX); // Center horizontally
    tspan2.setAttribute('dy', '1.2em'); // Vertical offset for the second line
    tspan2.setAttribute('font-style', 'italic');
    tspan2.setAttribute('font-size', 'smaller'); 
    tspan2.textContent = secondLine;
    tooltipText.appendChild(tspan2);

    // Add the tooltip text element to the SVG
    svg.appendChild(tooltipText); 
    const tooltipWidth = tooltipText.getBoundingClientRect().width;
    const tooltipHeight = tooltipText.getBoundingClientRect().height;
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    let tooltipX, tooltipY;

    // Check if the tooltip is outside horizontally
    if (btnX - tooltipWidth / 2 < 0) {
        // Adjust horizontally if the tooltip is too close to the left edge
        tooltipX = 0;
    } else if (btnX + tooltipWidth / 2 > screenWidth) {
        // Adjust horizontally if the tooltip is too close to the right edge
        tooltipX = screenWidth - tooltipWidth;
    } else {
        // Center horizontally if there's enough space
        tooltipX = btnX - tooltipWidth / 2;
    }

    // Check if the tooltip is outside vertically
    if (btnY + 30 + tooltipHeight > screenHeight) {
        // Adjust vertically if the tooltip is too close to the bottom edge
        tooltipY = btnY - 25;
    } else {
        // Place the tooltip below the button if there's enough space
        tooltipY = btnY + 30;
    }

    // Set the tooltip position
    tooltipText.setAttribute('x', tooltipX);
    tooltipText.setAttribute('y', tooltipY);
    // Get the bounding box of the text element
    const bbox = tooltipText.getBBox();

    // Create a rectangle for the background
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.id = 'tooltip',
    rect.setAttribute('x', bbox.x);
    rect.setAttribute('y', bbox.y);
    rect.setAttribute('width', bbox.width); 
    rect.setAttribute('height', bbox.height); 
    rect.setAttribute('class', 'tooltiptext'); 
    if (dark) {
        rect.style.fill = '#050c17';
    } else {
        rect.style.fill = '#f0f0f0';
    }
 
    // Append the rectangle to the SVG or its parent element
    svg.insertBefore(rect, tooltipText);
    
}

function deleteTooltip() {
    // Remove the tooltip text element when mouse leaves the node 
    const existingTooltip = svg.querySelectorAll('.tooltiptext');
    existingTooltip.forEach(tooltip => {
        svg.removeChild(tooltip);
    });
        
}



//////////////////// FULL SCREEN GESTION ////////////////////
let previousWidth = window.innerWidth;
let previousHeight = window.innerHeight;
let windowWidthCorrec = 0;
let windowHeightCorrec = 0;

window.addEventListener('resize', function(event) {
    // Get the current window dimensions
    const currentWidth = window.innerWidth;
    const currentHeight = window.innerHeight;
    // // Calculate the change in width and height
    windowWidthCorrec = currentWidth - previousWidth;
    windowHeightCorrec = currentHeight - previousHeight;

    //Update links
    const links = document.querySelectorAll('.link');

    links.forEach(link => {
        updateLink(link);
    });
});

//////////////////// FIRST LOADING ////////////////////

let pendingLogin = false;
window.addEventListener('load', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (token) {
        fetch(`/api/shared_nodes/?token=${token}`)
        .then(response => {
            if (!response.ok) throw new Error('Failed to load nodes');
            return response.json();
        })
        .then(data => {
            if (data.nodes) {
                data.nodes.forEach(node => {    
                    displayNode(node);
                });
            } if (data.links) {
                data.links.forEach(link => {    
                    displayLink(link);
                });
            } if (data.params) {
                data.params.forEach(param => {    
                    loadParams(param); // TODO userID of original universe for saving operations
                });
            }  
            guest();  
            multiUsers();
        })
        .catch(error => console.error(error));
    } else {
        login();
    }
    console.log('Window has finished loading!');
    // Create the audio element
    const audio = document.createElement('audio');
    audio.id = 'music';
    audio.loop = true;
    // Create the source element
    const source = document.createElement('source');
    source.src = 'static/sound/atmosphere.mp3';
    source.type = 'audio/mpeg';
    // Append the source to the audio element
    audio.appendChild(source);
    // Append the audio element to the document body (or a specific container)
    document.body.appendChild(audio);
    // Asynchronously load the audio
    audio.load();
});

function login() {
    let popup = document.createElement('div');
    popup.id = 'loginPopup'
    popup.className = 'popup'; 
    popup.style.height = 'fit-content';
    popup.style.border = 'transparent';
    popup.style.background = 'transparent';
    popup.style.alignItems = 'center';

    popup.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });

    const message = document.createElement('div');
    message.className = 'message';   
    message.textContent = `Bienvenue dans Nod-Z`;
    message.style.marginBottom = '30px';
    message.style.color = '#5753b996';
    message.style.textShadow = `
        -1px -1px 0 #440852,  
         1px -1px 0 #440852,  
        -1px  1px 0 #440852,  
         1px  1px 0 #440852
    `;
    
    const iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.display = 'none';  
    
    popup.appendChild(message);
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'popupbutton-container'; 
    const loginButton = document.createElement('button');
    loginButton.id = 'loginButton';
    loginButton.textContent = 'CONNEXION';
    loginButton.className = 'submit-button log-button';  
    loginButton.style.padding = '5px';
    
    loginButton.addEventListener('click', function() {        
        iframe.style.display = 'block';
        if(popup.contains(message)) {
            message.style.display = 'none';
            buttonContainer.style.display = 'none';     
        }
        pendingLogin = true;        
        iframe.src = NODZ_BASE + '/login/';    
    });
    buttonContainer.appendChild(loginButton);

    const guestButton = document.createElement('button');
    guestButton.id = 'guestButton';
    guestButton.textContent = 'INVITÉ';
    guestButton.className = 'submit-button log-button secondary'; 
    guestButton.style.padding = '5px';

    guestButton.addEventListener('click', function() {
    
        guest();
        document.body.removeChild(popup);
    });


    buttonContainer.appendChild(guestButton);
    popup.appendChild(buttonContainer);
    popup.appendChild(iframe);
    document.body.appendChild(popup);

    popup.addEventListener('wheel', function(event) {
        event.preventDefault();
    });
    popup.addEventListener('mousedown', function(event) {
        event.preventDefault();       
    });
    popup.addEventListener('contextmenu', function(event) {
        event.preventDefault();       
    });

    document.addEventListener('mousedown', function(event) {        
        if(pendingLogin && layer.contains(event.target)) {
            if (document.getElementById('loginPopup')) {
                document.getElementById('loginPopup').parentNode.removeChild(document.getElementById('loginPopup'));
            }
            if(!guestUser){
                login();          
                pendingLogin = false;  
            }                            
        }        
    });
}










function guest() {
    document.getElementById('exportButton').className = 'save';
    fetch('/guest')
    .then(async response => {
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Server Error: ${errorData.error}`);
        }
        return response.json();
    })
    .then(data => {
        // Handle the response data
        console.log('Guest',data.userID)
        userName = data.userName;
        isLoggedIn = true;
        nodeCounter = 0;
        linkCounter = 0; 
        layerCounter = 1;
        layerNumber = 1;
        layers.push({ id: 1, name: 'Home' });
        selectedLayer = layers[0];
        renderLayers(); 
        loadingSpinner.style.display = 'none';
        guestUser = true;
        const notification = document.getElementById('notificationButton');
        notification.dataset.count = 0;
        // Dispatch custom event
        const event = new Event('countChange');
        notification.dispatchEvent(event);
    })
    .catch(error => {
        // Handle errors
        console.error('There was a problem with the fetch operation:', error.message);
    });
}


//////////////////// COUNTER LABEL FOR NAVIGATION ////////////////////

const counters = document.querySelectorAll('.triangle-container');
// Loop through each counter
counters.forEach(counter => {
    
    counter.addEventListener('mousedown', function(event) {
        event.preventDefault();
        const ID = counter.children[1].id;
        let dir; 
        if (ID === 'top-left-corner') {
            dir = 0;
        } else if (ID === 'top-right-corner') {
            dir = 1;
        } else if (ID === 'bottom-left-corner') {
            dir = 2;
        } else {
            dir = 3;
        }
        let dirSelect = [];
        const nodeGroups = document.querySelectorAll('.node-group');
        nodeGroups.forEach(node => {
            if (isOnScreen(node) === dir) {
                dirSelect.push(node);
            }            
        }) 
        
        const target = closestNode(dirSelect);
        focusNode(target,false);
    });
    counter.addEventListener('wheel', function(event) {
        event.preventDefault();
    });
    counter.addEventListener('mouseover', function() {
        if(!counter.classList.contains('counter-zero')){
            counter.children[0].style.cursor = 'pointer';
            if(dark) {
                root.setAttribute('fill', '#1E90FF')
                counter.children[1].style.color = '#1E90FF';
            } else {
                root.setAttribute('fill', '#a553b9c0')
                counter.children[1].style.color = '#a553b9c0';
            }
        } else if (!counter.classList.contains('counter-zero')){
            counter.children[0].style.cursor = 'crosshair';
        } 
    });
    counter.addEventListener('mouseout', function() {
        counter.children[1].style.color = 'ivory';
        root.setAttribute('fill', 'transparent')
    });
}); 

function navigationLabels(navigationCounters) {
    const counters = document.querySelectorAll('.counter');
    // Loop through each counter
    counters.forEach(counter => {
        if (counter.id === 'top-left-corner') {
            counter.textContent = navigationCounters[0];
        } else if (counter.id === 'top-right-corner') {
            counter.textContent = navigationCounters[1];
        } else if (counter.id === 'bottom-left-corner') {
            counter.textContent = navigationCounters[2];
        } else {
            counter.textContent = navigationCounters[3];
        }
        const triangleContainer = counter.parentElement;
        // Check if counter value is 0
        if (counter.textContent.trim() === '0') {
            // Add class to make counter transparent
            counter.classList.add('counter-zero');
            triangleContainer.classList.add('counter-zero');
        } 
        else {
            counter.classList.remove('counter-zero');
            triangleContainer.classList.remove('counter-zero');
        }
    });
}


//////////////////// COLORWHEEL ////////////////////

const picker = new ColorWheel(function (eventState) {
    // Callback function to handle color changes
    if (eventState === 0 || eventState === 1 || eventState === 2) {         
        var selectedColorCSS = picker.css;

        if (colorContext === 'node') {
            selectedNodes.forEach(nodeGroup => {
                if(selectedColorCSS) {
                    nodeGroup.setAttribute('color',selectedColorCSS); 
                } 
                if (nodeGroup.getAttribute('lock') === '0') {
                    if(nodeGroup.getAttribute('shape') === 'circle'){
                        nodeGroup.children[1].style.stroke = selectedColorCSS;
                        currentNode.children[1].style.strokeWidth = '11px';
                    } else if(nodeGroup.getAttribute('shape') === 'square'){
                        nodeGroup.children[2].style.stroke = selectedColorCSS;
                        currentNode.children[2].style.strokeWidth = '9px';
                    } 
                     
                    const linksAttribute = JSON.parse(nodeGroup.getAttribute('links'));
                    linksAttribute.forEach(id => {
                        const link = document.getElementById(id);
                        if(linkState === 0) {
                            updateLinkColor(link);  
                        } 
                    });     
                }   
            });            

        }  else if (colorContext === 'text' && eventState === 0) {
            const savedSelection = saveSelection();
            const input = currentNode.children[0].children[0];
  
            document.execCommand('foreColor', false, selectedColorCSS);
            colorWheelfo.setAttribute('visibility', 'hidden');
            
            setTimeout(function() {            
                input.focus(); 
                restoreSelection(savedSelection);
            }, 200); 
            setTimeout(save(currentNode),1000);        

        }  else if (colorContext === 'sketch') {
            const canvas = currentNode.children[0].children[3];
            var ctx = canvas.getContext('2d');
            colorWheelfo.setAttribute('visibility', 'hidden');
            ctx.strokeStyle = selectedColorCSS;     
            setTimeout(save(currentNode),1000);                           
        }      
    } 
},
300, // Specify the size 
{ showTriangle: true } 
);

picker.setHSV(194, .8, .8);

var colorWheelfo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
colorWheelfo.id = 'colorWheel';
colorWheelfo.appendChild(picker.canvas);
colorWheelfo.setAttribute('visibility', 'hidden');
// universe.appendChild(colorWheelfo); 

picker.canvas.addEventListener('visible', function(e) {
    svg.style.cursor = 'pointer';
});
picker.canvas.addEventListener('mouseenter', function(e) {
    svg.style.cursor = 'pointer';
});


//////////////////// CALENDAR //////////////////// 
const calendarOverlay = document.getElementById('calendarOverlay');

const fp = flatpickr(calendarOverlay, {
    enableTime: true,
    dateFormat: "d-m-Y H:i",
    time_24hr: true,
});

function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0'); 
    const month = String(date.getMonth() + 1).padStart(2, '0'); 
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0'); 
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}-${month}-${year} ${hours}:${minutes}`; 
}

//////////////////// FILE NAME TRUNCATION ////////////////////

function truncateMiddleText(original, element, maxLength) {
    let text = original.trim();     
    let startLength = Math.ceil(maxLength / 2) - 2;
    let endLength = Math.floor(maxLength / 2) - 1;
    let start = text.slice(0, Math.ceil(maxLength / 2) - 2); // First part
    let end = text.slice(-Math.floor(maxLength / 2) + 2); // Last part
    if (startLength + endLength >= text.length) {
        element.innerText = text; 
    } else {
        element.innerText = start + "..." + end; // Insert middle ellipsis
    }       
}

//////////////////// NOTIFICATION ////////////////////
const notification = document.getElementById('notificationButton');
let notificationsDate = [];

notification.addEventListener('countChange', function (e) {
    // Get current date
    const now = new Date();
    notification.dataset.count = 0;

    notificationsDate.forEach(date => {
        if (date[0] < now) {
            console.log('The notification date is in the past.');
            notification.dataset.count = parseInt(notification.dataset.count) + 1;
        } else {
            console.log('The notification date is in the future.');
        }
    });

    if (parseInt(notification.dataset.count) === 0) {
        notification.style.display = 'none';
    } else {
        notification.style.display = 'block';
    }
});

var notificationIndex = 0;
notification.addEventListener('click', function () {
    const now = new Date();
    if (notificationIndex + 1 > notificationsDate.length){
        notificationIndex = 0;
    }
    if (notificationsDate[notificationIndex][0] < now) {
        if (parseInt(notificationsDate[notificationIndex][1]) === layerNumber) {
            focusNode(document.getElementById(notificationsDate[notificationIndex][2]),true)
            CurrentNode(document.getElementById(notificationsDate[notificationIndex][2]));
            currentNode.children[1].setAttribute('class', 'selectednode');
            currentNode.tools.type.children[6].children[0].click()
        } else {
            layerNumber = notificationsDate[notificationIndex][1];
            seeNotification = true;
            load(parseInt(notificationsDate[notificationIndex][1]), notificationsDate[notificationIndex][2])
        }  
        if (notificationIndex + 1 <+ notificationsDate.length) {
            if(notificationsDate[notificationIndex+1][0] < now){
                notificationIndex += 1; 
            }            
        }
    }    
});


//////////////////// FONT SIZE ////////////////////

function getMaxFontSize(element) {
    // This will find the largest font size in the element's children
    let maxFontSize = 0;

    // Loop through all child elements (including text nodes)
    const children = element.childNodes; // This includes both element nodes and text nodes

    for (let child of children) {
        if (child.nodeType === 1) {  // Check if the child is an element (not a text node)
            // Get the font size of the child element
            const fontSize = window.getComputedStyle(child).fontSize;
            const numericFontSize = parseFloat(fontSize);
            if (numericFontSize > maxFontSize) {
                maxFontSize = numericFontSize;
            }
        }
    }
    if(maxFontSize === 0){
        maxFontSize = 15;
    }

    return maxFontSize;
}




//////////////////// RANDOM COLOR ////////////////////

// function getRandomColor() {
//     const letters = '0123456789ABCDEF';
//     let color = '#';
//     for (let i = 0; i < 6; i++) {
//         color += letters[Math.floor(Math.random() * 16)];
//     }
//     return color;
// }

function getRandomColor() {
    // Generate random RGB values in the range [128, 255] for a neon effect
    const r = Math.floor(Math.random() * 128) + 128;  // Values between 128 and 255
    const g = Math.floor(Math.random() * 128) + 128;  // Values between 128 and 255
    const b = Math.floor(Math.random() * 128) + 128;  // Values between 128 and 255

    // Convert RGB to HEX format and return
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

//////////////////// NAVIGATION GRAVITY ////////////////////

function closestNode(nodes){
    var closestDistance = Infinity;
    var target = null;
   
    nodes.forEach(node => {
        const nodeCenterX = parseInt(node.getAttribute('x')) - parseInt(root.getAttribute('x'))/currentZoom;
        const nodeCenterY = parseInt(node.getAttribute('y')) - parseInt(root.getAttribute('y'))/currentZoom;
        
        const distance = Math.sqrt(Math.pow(nodeCenterX, 2) + Math.pow(nodeCenterY, 2));
        if (distance < closestDistance) {
            closestDistance = distance;
            target = node;
        }
    });
    return target;
}

// function permanentFocus(){
//     if (!currentNode && selectedNodes.length === 0 && !currentLink){     
//         const originX = (parseFloat(root.getAttribute('x')))/currentZoom;
//         const originY = (-parseFloat(root.getAttribute('y')))/currentZoom;

//         const target = closestNode();

//         if(!target || colorWheelfo.getAttribute('visibility') === 'visible') {
//             return;
//         }

//         const nodeX = parseFloat(target.getAttribute('x'));
//         const nodeY = parseFloat(target.getAttribute('y'));   

//         const transfoX =  windowWidthCorrec/2 + (originX - nodeX)*currentZoom;
//         const transfoY = windowHeightCorrec/2 + (originY + nodeY)*currentZoom;
//         if(Math.abs(transfoX)<1 || Math.abs(transfoY)<1){
//             return;
//         }
//         dragUniverse(transfoX/3000,transfoY/3000); 
         
//         setTimeout(() => {
//             permanentFocus();   
//         }, 1);
            
//     } 
// }

//////////////////// PREVENT DEFAULT ////////////////////

document.getElementById('logo').addEventListener('mousedown', function(event) {
    event.preventDefault();
});

document.getElementById('profile').addEventListener('contextmenu', function(event) {
    event.preventDefault();
});

document.getElementById('layersList').addEventListener('mousedown', function(event) {
    event.preventDefault();
});

document.getElementById('edit-modal').addEventListener('mousedown', function(event) {
    if(event.target !== document.getElementById('layer-name-input')) {
        event.preventDefault();
    }    
});

document.getElementById('layersList').addEventListener('contextmenu', function(event) {
    event.preventDefault();
});

document.getElementById('edit-modal').addEventListener('contextmenu', function(event) {
    event.preventDefault();
});
