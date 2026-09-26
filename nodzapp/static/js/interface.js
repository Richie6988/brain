
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
        document.getElementById('tutorialButton').disabled = true;
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
    document.getElementById('tutorialButton').disabled = false;
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
    background: url('/static/img/gradlink.svg') no-repeat center/cover;
    background-size: 90%;
}`;

document.getElementById('linksButton').addEventListener('click', function() {
    const styleElement = document.getElementById('linksButton-style');
    const links = document.querySelectorAll('.link');
    deleteTooltip();

    if (linkState === 0){
        styleElement.textContent = `
        #linksButton::after {
            background: url('/static/img/link.svg') no-repeat center/cover;
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
            background: url('/static/img/nolink.svg') no-repeat center/cover;
            background-size: 90%;
        }`;

        links.forEach(link => {  
            link.style.display = 'none';
        });
        linkState = 2;
    } else {
        styleElement.textContent = `
        #linksButton::after {
            background: url('/static/img/gradlink.svg') no-repeat center/cover;
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


document.getElementById('originButton').addEventListener('click', function() {
    dragUniverse(parseFloat(root.getAttribute('x'))-originX*currentZoom,-originY*currentZoom - parseFloat(root.getAttribute('y')));
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

    placeFlag();

    function placeFlag() {
        // Create a flag element
        const flagImage = document.createElementNS('http://www.w3.org/2000/svg', 'image');

        // Set the href attribute to point to the image source (e.g., flag icon)
        flagImage.setAttributeNS(null, 'href', '/static/img/pin.svg');
        
        // Set the width and height of the image
        flagImage.setAttribute('width', '30px');
        flagImage.setAttribute('height', '30px');

        // Set the x and y coordinates for positioning
        flagImage.setAttribute('x', window.innerWidth/2 - parseFloat(flagImage.getAttribute('width'))/2);
        flagImage.setAttribute('y', window.innerHeight/2 - parseFloat(flagImage.getAttribute('height'))/2);
       
        // Append the flag to the map
        svg.appendChild(flagImage);
  
        // Optional: Remove the flag after a few seconds
        setTimeout(() => {
            flagImage.remove();
        }, 3000); 
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

document.getElementById('tutorialButton').addEventListener('mouseover', function() {
    createTooltip ('tutorialButton','Tutorial');
});

let first = 0;
document.getElementById('tutorialButton').addEventListener('click', function() {
    var tutorial = document.getElementById('tutorial');
    tutorial.style.display = 'flex';
    tutorial.children[0].scrollTop = 0; 
    overlay = true;
    
    window.addEventListener('click', function(event) {
        tuti = document.getElementById('tutorial');
        if (event.target === tutorial) {
            tutorial.style.display = 'none';
            overlay = false;
        }
    });
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
                copyButton.textContent = 'COPY';
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
                            message.textContent = "Link copied to clipboard!"; 
                            setTimeout(closePopup, 1000);
                        }).catch(err => {
                            console.error('Failed to copy text: ', err);
                        });
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
        exportBtn.textContent = 'Export';
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
        const dropdowns = document.querySelectorAll('.select-dropdown')
        layer.classList.add('lightmode');
        for (let i = 0; i < dropdowns.length; i++) {
            dropdowns[i].className = 'selectlight';       
        }

        const fourDs = document.querySelectorAll('.raydark')
        fourDs.forEach(node => {
            node.classList.remove('raydark');
            node.classList.add('raylight');
        });

        const colorLogo = document.querySelectorAll('img');
        colorLogo.forEach(color => {
            if (color.getAttribute('src') === '/static/img/colorpicking.svg'){
                color.setAttribute('src', '/static/img/colorpicking-light.svg');
            } else if (color.getAttribute('src') === '/static/img/bold.svg'){
                color.setAttribute('src', '/static/img/bold-light.svg');
            } else if (color.getAttribute('src') === '/static/img/italic.svg'){
                color.setAttribute('src', '/static/img/italic-light.svg');
            } else if (color.getAttribute('src') === '/static/img/underline.svg'){
                color.setAttribute('src', '/static/img/underline-light.svg');
            } else if (color.getAttribute('src') === '/static/img/smiley.svg'){
                color.setAttribute('src', '/static/img/smiley-light.svg');
            } else if (color.getAttribute('src') === '/static/img/view.svg'){
                color.setAttribute('src', '/static/img/view-light.svg');
            } else if (color.getAttribute('src') === '/static/img/unlock.svg'){
                color.setAttribute('src', '/static/img/unlock-light.svg');
            } else if (color.getAttribute('src') === '/static/img/edit.svg'){
                color.setAttribute('src', '/static/img/edit-light.svg');
            } else if (color.getAttribute('src') === '/static/img/calendar.svg'){
                color.setAttribute('src', '/static/img/calendar-light.svg');
            } else if (color.getAttribute('src') === '/static/img/lock.svg'){
                color.setAttribute('src', '/static/img/lock-light.svg');
            } else if (color.getAttribute('src') === '/static/img/layer.svg'){
                color.setAttribute('src', '/static/img/layer-light.svg');
            } else if (color.getAttribute('src') === '/static/img/newimg.svg'){
                color.setAttribute('src', '/static/img/newimg-light.svg');
            } else if (color.getAttribute('src') === '/static/img/undo.svg'){
                color.setAttribute('src', '/static/img/undo-light.svg');
            } else if (color.getAttribute('src') === '/static/img/redo.svg'){
                color.setAttribute('src', '/static/img/redo-light.svg');
            } else if (color.getAttribute('src') === '/static/img/eraser.svg'){
                color.setAttribute('src', '/static/img/eraser-light.svg');
            } else if (color.getAttribute('src') === '/static/img/eraseall.svg'){
                color.setAttribute('src', '/static/img/eraseall-light.svg');
            } else if (color.getAttribute('src') === '/static/img/circle.svg'){
                color.setAttribute('src', '/static/img/circle-light.svg');
            } else if (color.getAttribute('src') === '/static/img/square.svg'){
                color.setAttribute('src', '/static/img/square-light.svg');
            } else if (color.getAttribute('src') === '/static/img/line.svg'){
                color.setAttribute('src', '/static/img/line-light.svg');
            } else if (color.getAttribute('src') === '/static/img/upload.svg'){
                color.setAttribute('src', '/static/img/upload-light.svg');
            } else if (color.getAttribute('src') === '/static/img/download.svg'){
                color.setAttribute('src', '/static/img/download-light.svg');
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
        const dropdowns = document.querySelectorAll('.selectlight')
        layer.classList.remove('lightmode');
        for (let i = 0; i < dropdowns.length; i++) {
            dropdowns[i].className = 'select-dropdown';  
        }

        const fourDs = document.querySelectorAll('.raylight')
        fourDs.forEach(node => {
            node.classList.remove('raylight');
            node.classList.add('raydark');
        });

        const colorLogo = document.querySelectorAll('img');
        colorLogo.forEach(color => {
            if (color.getAttribute('src') === '/static/img/colorpicking-light.svg'){
                color.setAttribute('src', '/static/img/colorpicking.svg');
            } else if (color.getAttribute('src') === '/static/img/bold-light.svg'){
                color.setAttribute('src', '/static/img/bold.svg');
            } else if (color.getAttribute('src') === '/static/img/italic-light.svg'){
                color.setAttribute('src', '/static/img/italic.svg');
            } else if (color.getAttribute('src') === '/static/img/underline-light.svg'){
                color.setAttribute('src', '/static/img/underline.svg');
            } else if (color.getAttribute('src') === '/static/img/smiley-light.svg'){
                color.setAttribute('src', '/static/img/smiley.svg');
            } else if (color.getAttribute('src') === '/static/img/view-light.svg'){
                color.setAttribute('src', '/static/img/view.svg');
            } else if (color.getAttribute('src') === '/static/img/unlock-light.svg'){
                color.setAttribute('src', '/static/img/unlock.svg');
            } else if (color.getAttribute('src') === '/static/img/edit-light.svg'){
                color.setAttribute('src', '/static/img/edit.svg');
            } else if (color.getAttribute('src') === '/static/img/calendar-light.svg'){
                color.setAttribute('src', '/static/img/calendar.svg');
            } else if (color.getAttribute('src') === '/static/img/lock-light.svg'){
                color.setAttribute('src', '/static/img/lock.svg');
            } else if (color.getAttribute('src') === '/static/img/layer-light.svg'){
                color.setAttribute('src', '/static/img/layer.svg');
            } else if (color.getAttribute('src') === '/static/img/newimg-light.svg'){
                color.setAttribute('src', '/static/img/newimg.svg');
            } else if (color.getAttribute('src') === '/static/img/undo-light.svg'){
                color.setAttribute('src', '/static/img/undo.svg');
            } else if (color.getAttribute('src') === '/static/img/redo-light.svg'){
                color.setAttribute('src', '/static/img/redo.svg');
            } else if (color.getAttribute('src') === '/static/img/eraser-light.svg'){
                color.setAttribute('src', '/static/img/eraser.svg');
            } else if (color.getAttribute('src') === '/static/img/eraseall-light.svg'){
                color.setAttribute('src', '/static/img/eraseall.svg');
            } else if (color.getAttribute('src') === '/static/img/circle-light.svg'){
                color.setAttribute('src', '/static/img/circle.svg');
            } else if (color.getAttribute('src') === '/static/img/square-light.svg'){
                color.setAttribute('src', '/static/img/square.svg');
            } else if (color.getAttribute('src') === '/static/img/line-light.svg'){
                color.setAttribute('src', '/static/img/line.svg');
            } else if (color.getAttribute('src') === '/static/img/upload-light.svg'){
                color.setAttribute('src', '/static/img/upload.svg');
            } else if (color.getAttribute('src') === '/static/img/download-light.svg'){
                color.setAttribute('src', '/static/img/download.svg');
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
    message.textContent = `Welcome to Nod-Z`;
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
    loginButton.textContent = 'LOGIN';
    loginButton.className = 'submit-button log-button';  
    loginButton.style.padding = '5px';
    
    loginButton.addEventListener('click', function() {        
        iframe.style.display = 'block';
        if(popup.contains(message)) {
            message.style.display = 'none';
            buttonContainer.style.display = 'none';     
        }
        pendingLogin = true;        
        iframe.src = '/login/';    
    });
    buttonContainer.appendChild(loginButton);

    const guestButton = document.createElement('button');
    guestButton.textContent = 'GUEST';
    guestButton.className = 'submit-button log-button secondary'; 
    guestButton.style.padding = '5px';

    guestButton.addEventListener('click', function() {
    
        guest();
        document.body.removeChild(popup);
        //tuto();
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


//// Tutorial ////
let tutoPhase = 0;
function tuto(node){  
    if(node){
        node.children[0].style.display='none';
        node.children[4].style.display='none';
        node.children[5].style.display='none';
        node.children[6].style.display='none';
        nodeSizing(node,110,110);
    }
    console.log('tutophase:', tutoPhase)
    switch (tutoPhase) {
        case 0:
            overlay = true;
            displayTutorial = true;
            //// Tuto 1st sequence ////
            var intro = document.createElement('div');
            intro.id = 'intro';
            intro.className = 'tuto'; 
            intro.innerHTML = `
                <strong>...Nod: </strong> Some say I’m a <strong>relational, multimodal, and multidimensional tool</strong> designed to store pieces of your mind.<br>
                <br>But please call me Nod! <br><br>
                I can hold various forms of content including <strong>text</strong> for notes, 
                <strong>images</strong>, <strong>videos</strong>, or even <strong>3D models</strong> to help visualize ideas. 
                I can also support <strong>sketching</strong> to enhance your creativity and <strong>file embedding and visualization</strong> 
                to document ideas seamlessly.
            `;
            document.body.appendChild(intro);
            // Apply CSS 
            intro.style.position = 'fixed';
            const introHeight = intro.getBoundingClientRect().height;
            intro.style.top = `calc(50% - ${introHeight / 2}px)`; 
            intro.style.left = '50%';
            intro.style.transform = 'translateX(-50%)'; // Centers the element horizontally
            intro.style.width = '80%'; 
            intro.style.zIndex = '1000'; // Ensure it stays on top of other elements
        
            var gotit_btn = document.createElement('button');
            gotit_btn.id = 'gotit_btn';
            gotit_btn.textContent = 'LET\'S GO';
            gotit_btn.className = 'submit-button';  
            gotit_btn.style.padding = '5px';
            gotit_btn.style.fontSize = '10px';
            gotit_btn.style.backgroundColor = '#6748a67e';
        
            // Apply CSS 
            gotit_btn.style.position = 'fixed';
            gotit_btn.style.width = `70px`; 
            gotit_btn.style.bottom = `140px`; 
            gotit_btn.style.left = '50%';
            gotit_btn.style.transform = 'translateX(-50%)'; // Centers the element horizontally
            gotit_btn.style.zIndex = '1000'; // Ensure it stays on top of other elements        
            document.body.appendChild(gotit_btn);
             
            var tutoDescription = document.createElement('p');
            tutoDescription.id = 'node0';
            tutoDescription.className = 'tuto';
            tutoDescription.style.width = '90%';
            tutoDescription.style.position = 'fixed';
            tutoDescription.style.top = `80%`; 
            tutoDescription.style.left = '50%';
            tutoDescription.style.transform = 'translateX(-50%)'; 
            tutoDescription.style.zIndex = '1000'; // Ensure it stays on top of other element
            tutoDescription.style.justifyContent = 'center';
            tutoDescription.style.height = 'fit-content';
            document.body.appendChild(tutoDescription);

            intro.addEventListener('mousedown', function(e) {
                e.preventDefault();
            })
            tutoDescription.addEventListener('mousedown', function(e) {
                e.preventDefault();
            })
        
            gotit_btn.addEventListener('mousedown', function(e) {
                tutoPhase += 1;
                tuto();
            })
          
            break;
        case 1:
            intro = document.getElementById('intro');
            tutoDescription = document.getElementById('node0');
            gotit_btn = document.getElementById('gotit_btn');

            document.body.removeChild(intro)
            
            tutoDescription.innerHTML = `<strong>Double click</strong> to create a node at center<br><strong>Press space bar</strong> to create a node at pointer`;
            tutoDescription.style.pointerEvents = 'none';
      
            gotit_btn.textContent = 'GOT IT'
            gotit_btn.style.opacity = 0;
           
            break;
        case 2:
            tutoDescription = document.getElementById('node0');
            gotit_btn = document.getElementById('gotit_btn');

            var tutoP = `Click on my edges to <strong>select me</strong>. You can also use a selection window while pressing <strong>Control Key</strong>. <br>
            When selected, you access my <strong>options</strong>, <strong>move</strong> me around, or <strong>connect</strong> me with other nodes.<br>
            Another click will <strong>unselect</strong> me, and let you access to my <strong>content</strong>.
            `;
            tutoDescription.innerHTML = tutoP;

            document.getElementById('gotit_btn').style.opacity = 1;
            break;
        case 3:
            tutoDescription = document.getElementById('node0');

            tutoP = `
            <strong>Move universe</strong>: <strong>click & drag</strong> the background or use <strong>2 fingers on touchpad</strong>.<br>
            <strong>Zoom</strong>: use the <strong>mouse wheel</strong> or <strong>pinch gesture on a touchpad</strong>. <br>
            <strong>Tab Key</strong>: jump between extreme zoom levels at <strong>cursor position</strong>.
            `;
            tutoDescription.innerHTML = tutoP;
            break;
        case 4:
            tutoDescription = document.getElementById('node0');
            tutoP = `
            Select me and other nodes and press <strong>Space Bar</strong> to link us.<br>
            You can also use it to directly create a<strong>connected node</strong>
            `;
            tutoDescription.innerHTML = tutoP;
            break;
        case 5:
            tutoDescription = document.getElementById('node0');
            gotit_btn = document.getElementById('gotit_btn');
            
            document.body.removeChild(tutoDescription);
            const nodeGroups = document.querySelectorAll('.node-group');
            // Iterate through each nodeGroup and check the condition
            for (let i = 0; i < nodeGroups.length; i++) {
                deleteNode([nodeGroups[i]]);                
            }
            displayTutorial = false;
            document.body.removeChild(gotit_btn);

            nodeCounter = 0;
            linkCounter = 0;

            buttonContainer.classList.add("show");
            const tutorial = document.getElementById('tutorialButton');
            tutorial.classList.add('rookie');

            setTimeout(() => {
                tutorial.classList.remove('rookie');
            }, 400);
            setTimeout(() => {
                tutorial.classList.add('rookie');
            }, 400);
          

            setTimeout(() => {
                document.getElementById('tutorialButton').click();
                tutorial.classList.remove('rookie');
                buttonContainer.classList.remove("show");
            }, 1000);

            if(!isLoggedIn) {
                loadingSpinner.style.display = 'block';
            }
            break;
    }
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


//////////////////// YOUTUBE VIDEO PLAYER ////////////////////

let players = [];
let videoIds = [];

let isAPIReady = false;

// Function is called by the YouTube API when it is ready
function onYouTubeIframeAPIReady() {
    isAPIReady = true;
    console.log("YT API ready")
}


// Function to initialize a YouTube player for a nodegroup
function initializePlayer(counter,video) {
    if (isAPIReady) {
        // Initialize the YouTube player
        players[counter] = new YT.Player(`videoplayer-${counter}`, {
            height: '250',
            width: '350',
            videoId: videoIds[counter], // The video ID will be set when the video is loaded
            host: 'http://www.youtube-nocookie.com',
            playerVars: {
                modestbranding: 0,
                controls: 1,
                iv_load_policy:3,
                loop:0,
                rel:0,
                showinfo:0,           
                autoplay: 1, 
                disablekb: 1,
                fs: 1,
                mute: 0,
                autohide: 1,
                loaded: 0,
                enablejsapi: 0,
                size: 0,
                origin: window.location.origin,
                enablejsapi: 1, // Enable JS API
            },
            events: {
                'onReady': function () {},
                'onStateChange': (event) => onPlayerStateChange(event, counter),
                'onError': function (event) {
                    // console.error(`YouTube Player Error [Counter: ${counter}]`, event);
                    if (videoIndex === videoSearch.length - 1) {
                        videoIndex = 0;
                    } else {
                        videoIndex += 1;
                    }          
                    document.getElementById(`videoinput-${counter}`).value = videoSearch[videoIndex];
                    document.getElementById(`N-${counter}`).setAttribute('videolink',videoSearch[videoIndex])   
                    if(intervalId === null)  {
                        loadYouTubeVideo(counter);  
                    }
                }
            }
        });

    } else {
        console.log('API is not ready yet. Please wait.');
    }  

}

function onPlayerStateChange(event, counter) {
    const states = {
        '-1': 'UNSTARTED',
        '0': 'ENDED',
        '1': 'PLAYING',
        '2': 'PAUSED',
        '3': 'BUFFERING',
        '5': 'VIDEO_CUED'
    };
    
    // console.log(`Player ${counter} state changed to:`, states[event.data]);

    if (event.data === YT.PlayerState.PLAYING) {
        document.getElementById(`N-${counter}`).setAttribute('videocontent',players[counter].videoTitle);
        console.log(document.getElementById(`N-${counter}`).getAttribute('videocontent'))

        if(sound){
            var audio = document.getElementById('music'); 
            document.getElementById('soundButton').className = 'soundoff';
            sound = false;             
            audio.pause();
        } 
    }
}

// Function to load and play the YouTube video
function loadYouTubeVideo(counter) {
    // Get the YouTube video ID from the input field
    var url = document.getElementById(`videoinput-${counter}`).value || 'v=0FBiyFpV__g';  

    if (url !== null && url !== "") {  
        videoIds[counter] = extractYouTubeVideoId(url,counter);   
        if(players[counter]){
            players[counter].loadVideoById(videoIds[counter]);
            console.log('Existing player'); 
        } else {
            initializePlayer(counter,videoIds[counter]); 
            console.log('New player');
        }
    } 
}

let videoSearch = ['v=0FBiyFpV__g','v=x7eH-VqRhyA','v=MILbOVRVeOk','v=DHUnz4dyb54','v=39uYW98qOV0','v=6dp-bvQ7RWo'];
let videoIndex = 0;
// Variable to hold the interval ID
let intervalId;

// Function to toggle the color of the buttons
function toggleButtonColor(button) {
    button.classList.toggle('search-button-loading'); // Add or remove the class
}

// Function to start the alternating color change
function startAlternatingColor(lbutton,rbutton) {
    // Set interval to toggle color every second
    intervalId = setInterval(function() {
        toggleButtonColor(lbutton); 
        toggleButtonColor(rbutton); 
    }, 1000);
}

// Function to stop the alternating color change
function stopAlternatingColor(lbutton,rbutton) {
    // Clear the interval
    clearInterval(intervalId);
    intervalId = null;
    if (lbutton.classList.contains('search-button-loading')) {
        lbutton.className = 'arrow-button search-button-left';
    }
    if (rbutton.classList.contains('search-button-loading')) {
        rbutton.className = 'arrow-button search-button-right';
    }
}


function extractYouTubeVideoId(url,counter) {
    document.getElementById(`videoinput-${counter}`).disabled = true;
    document.getElementById(`videoinput-${counter}`).value = 'loading...';
    startAlternatingColor(document.getElementById(`leftButton-${counter}`),document.getElementById(`rightButton-${counter}`));
   
    // Regular expression to match the video ID from the URL
    const regex = /(?:\/|%3D|v=|vi=)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
     
    if(match ? match[1] : null) {   
        document.getElementById(`N-${counter}`).setAttribute('videolink', match[0])  
        save(document.getElementById(`N-${counter}`));        
        document.getElementById(`videoinput-${counter}`).value = match[0];
        document.getElementById(`videoinput-${counter}`).disabled = false;
        stopAlternatingColor(document.getElementById(`leftButton-${counter}`),document.getElementById(`rightButton-${counter}`));
        return match ? match[1] : null;
    } else {
        const csrfToken = getCookie('csrftoken');
  
        fetch('YTsearch/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken,
            },
            body: JSON.stringify(url),
        }).then(response => {       
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            document.getElementById(`videoinput-${counter}`).disabled = false;
            stopAlternatingColor(document.getElementById(`leftButton-${counter}`),document.getElementById(`rightButton-${counter}`));
           
            return response.json();
        })
        .then(data => {
            // Handle the retrieved JSON data
            const inputElement = document.getElementById(`videoinput-${counter}`);

            // Create a new event
            var enterKeyEvent = new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13, // Deprecated but still used for compatibility
                which: 13,   // Deprecated but still used for compatibility
                bubbles: true,
                cancelable: true
            });

            videoSearch.length = 0;
            
            for (var i = 0; i < data.video_ids.length; i++) {
                videoSearch[i] = data.video_ids[i];
            }
    
            // Create a set to store unique values
            var uniqueVideoSearch = new Set(videoSearch);

            // Convert the set back to an array to remove duplicates
            videoSearch = Array.from(uniqueVideoSearch);
            console.log(data)
            const match = data.video_ids[0].match(regex);
            inputElement.value = match[0];
            document.getElementById(`N-${counter}`).setAttribute('videolink',match[0])
            save(document.getElementById(`N-${counter}`));
            setTimeout(() => {
                inputElement.dispatchEvent(enterKeyEvent);
            }, 200); 

        }).catch(error => {
            // Handle error
        });                   
    }  
}

// Function to pause the video
function pauseVideoIfOutOfViewport(counter) {
    var videocontainer = document.getElementById(`videoplayer-${counter}`);
    if (players[counter] && isOnScreen(videocontainer.parentElement.parentElement.parentElement) !== 4) {
        players[counter].pauseVideo();
    }
}

// Text infinite scroll

function scrollPlaceholder(input, text, speed = 100) {
    // Add extra spaces to create a gap between repetitions
    const fullText = text + "     ";
    let position = 0;
    let lastTime = 0;

    function animate(currentTime) {
        // Check if enough time has passed based on speed
        if (currentTime - lastTime > speed) {
            // Move the position one character at a time
            position = (position + 1) % fullText.length;
            
            // Create the scrolling effect
            const scrolledText = fullText.slice(position) + fullText.slice(0, position);
            
            // Update the placeholder
            input.placeholder = scrolledText;
            
            // Update last time
            lastTime = currentTime;
        }
        
        // Continue the animation
        requestAnimationFrame(animate);
    }

    // Start the animation
    requestAnimationFrame(animate);
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
            const canvas = currentNode.children[0].children[4];
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
            currentNode.children[7].children[6].children[0].click()
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
