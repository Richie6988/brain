from django.shortcuts import render, HttpResponse
from nodzapp.models import NodzUser, Param, Layer, Node, Link, Template, Feedback
from django.contrib.auth.views import LoginView
from django.contrib.auth.decorators import login_required
import re
import html
from django.shortcuts import render, redirect
from django.db.models import Max


# Create your views here.
def home(request):
    return render(request, "home.html")


from django.views.decorators.csrf import csrf_protect
from django.contrib.auth import authenticate, login
from django.contrib.auth.hashers import check_password


@csrf_protect
def checklogin(request):
    if request.method == 'POST':
        # Retrieve email and password from the POST request
        email = request.POST.get('email')
        password = request.POST.get('password')       

        if email and password:
            try:
                # Retrieve user object by email
                user = NodzUser.objects.get(email=email)
                
                # Check if the submitted password matches the hashed password
                if check_password(password, user.password):
                    # Passwords match, proceed with login
                    authenticated_user = authenticate(request, email=email, password=password)
                    
                    if authenticated_user is not None:
                        # User is authenticated, log them in
                        login(request, authenticated_user)                       
                        return HttpResponse(authenticated_user.id)
                    else:
                        # Authentication failed
                        return HttpResponse('Invalid email or password')
                else:
                    # Passwords don't match
                    return HttpResponse('Invalid email or password')
            except NodzUser.DoesNotExist:
                # User does not exist
                return HttpResponse('Invalid email or password')
        else:
            # Email or password not provided
            return HttpResponse('Email and password are required')
    else:
        # Method other than POST not allowed
        return HttpResponse('Method not allowed')


class LoginView(LoginView):
    template_name = 'registration/login.html'

import random
import string

def guest(request):
    if request.method == 'GET':  
        try:
            # Generate a random password
            password = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
             # Set the guest username and email
            last_user = NodzUser.objects.latest('id') if NodzUser.objects.exists() else None
            guest_id = last_user.id + 1 if last_user else 1
            username = f'Guest{guest_id}'
            email = f'guest{guest_id}@nodz.com'
            
            # Create a new instance of NodzUser with a random username and email
            new_user = NodzUser.objects.create_user(username=username, email=email, password=password)

            # Authenticate the newly created user
            authenticated_user = authenticate(request, email=email, password=password)
            if authenticated_user is not None:
                # Log in the user
                login(request, authenticated_user)
                Param.objects.create(user=authenticated_user)
                Layer.objects.create(user=authenticated_user, layer_id=1, layer_name="Home")

                # Return the user's ID as the response
                return JsonResponse({'userID': authenticated_user.id,'userName': username}, status=200)
            
            else:
                return JsonResponse({'error': 'Authentication failed.'}, status=401)
        
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    
    else:
        return JsonResponse({'error': 'Invalid request method.'}, status=400)
           

################ SET NEW PASSWORD ################
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse

@login_required
def set_password(request):
    if request.method == 'POST':
        new_password = request.POST.get('new_password')
        confirm_password = request.POST.get('confirm_password')

        # Check if passwords match
        if new_password != confirm_password:
            return JsonResponse({'error': 'Passwords do not match'}, status=400)

        # Set the new password for the logged-in user
        try:
            request.user.set_password(new_password)
            request.user.save()
            return JsonResponse({'message': 'Password updated successfully'}, status=200)
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)

    else:
        return JsonResponse({'error': 'Invalid request method.'}, status=400)


################ REGISTER ################

from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.contrib.auth.hashers import make_password

def register(request):
    if request.method == 'POST':
        pseudo = request.POST.get('username')
        email = request.POST.get('email')
        birthdate = request.POST.get('birthdate')
        password1 = request.POST.get('password1')
        password2 = request.POST.get('password2')

        if all([pseudo, email, birthdate, password1, password2]):
            try:
                validate_email(email)
            except ValidationError:
                return HttpResponse('Invalid email format')

            if password1 == password2:
                hashed_password = make_password(password1)

                # Handle user update if they previously used the platform without full registration
                print(f"Request user: {request.user}")
                print(f"Request user ID: {request.user.id}")
                print(f"Is authenticated: {request.user.is_authenticated}")
                if NodzUser.objects.filter(id=request.user.id).exists():
                    user = NodzUser.objects.get(id=request.user.id)
                    user.username = pseudo
                    user.email = email
                    user.birthdate = birthdate
                    user.password = hashed_password
                    user.save()

                    # Re-authenticate the user to update session
                    authenticated_user = authenticate(request, email=email, password=password1)
                    login(request, authenticated_user)
                    return HttpResponse('Saved')

                else:
                    # Direct registration for brand-new users
                    if NodzUser.objects.filter(email=email).exists():
                        return HttpResponse("This email is already used")

                    # Create the user account
                    new_user = NodzUser.objects.create(
                        username=pseudo,
                        email=email,
                        birthdate=birthdate,
                        password=hashed_password
                    )

                    authenticated_user = authenticate(request, email=email, password=password1)
                    if authenticated_user:
                        login(request, authenticated_user)
                        Layer.objects.create(user=authenticated_user, layer_id=1, layer_name="Home")
                        return HttpResponse(authenticated_user.id)
                    else:
                        return JsonResponse({'error': 'Authentication failed.'}, status=401)
            else:
                return HttpResponse("Password mismatch")
        else:
            return HttpResponse('All fields are required')

        
############################## FORGOT PASSWORD ##############################

def forgot_password(request):

    return render(request, 'registration/forgot_password.html')


from django.core.mail import send_mail
from django.shortcuts import render
from django.conf import settings
from .forms import ContactForm
from django.contrib import messages

def new_password(request):
    if request.method == 'POST':
        form = ContactForm(request.POST)
        if form.is_valid():
            # Get form data
            name = form.cleaned_data['name']
            email = form.cleaned_data['email']
            message = form.cleaned_data['message']

            # Send email
            try:
                send_mail(
                    f"New Contact Form Message from {name}",
                    f"Name: {name}\nEmail: {email}\nMessage: {message}",
                    settings.DEFAULT_FROM_EMAIL,
                    ['recipient-email@example.com'],  # Change this to your own email address
                    fail_silently=False,
                )
                messages.success(request, "Your message has been sent successfully!")
                return redirect('contact')
            except Exception as e:
                messages.error(request, f"Error: {e}")
        else:
            messages.error(request, "There was an error with your form.")
    else:
        form = ContactForm()

    return render(request, 'contact.html', {'form': form})

############################## USER IP/COUNTRY ##############################

from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver
import geoip2.database

GEOIP_DB_PATH = './GeoLite2-Country.mmdb'

@receiver(user_logged_in)
def capture_ip_country(sender, request, user, **kwargs):
    ip = get_client_ip(request)
    country = get_country_from_ip(ip)
    print(ip,country)
    # Update the user model
    user.ip_address = ip
    user.country = country
    user.save()

def get_client_ip(request):
    """Retrieve the client's IP address."""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0]
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip

def get_country_from_ip(ip):
    # Handle local IPs
    if ip in ['127.0.0.1', '::1']:
        return 'Local'  # Placeholder country code
    """Retrieve the country from the IP address."""
    try:
        with geoip2.database.Reader(GEOIP_DB_PATH) as reader:
            response = reader.country(ip)
            return response.country.iso_code
    except Exception:
        return None

############################## LAYERS GESTION ##############################

from django.http import JsonResponse
from nodzapp.models import Node, Link
from django.utils import timezone

import json
import logging

# Get an instance of a logger
logger = logging.getLogger(__name__)

@login_required
def save_layers(request):
    if request.method == 'POST':
        user = request.user
        try:
            json_data = json.loads(request.body)
            logger.debug(f'Received JSON data: {json_data}')  # Log the JSON data
    
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)

        # Save data to the database
        for group_data in json_data:
            if 'layerid' in group_data:
                layer, created = Layer.objects.get_or_create(user=user,layer_id = group_data['layerid'])
                layer = Layer.objects.filter(user=user,layer_id = group_data['layerid'])
                layer.update(
                    layer_id = group_data['layerid'],
                    layer_name = group_data['layername'],
                )
            else:
                Param.objects.get_or_create(user=user)
                param = Param.objects.filter(user=user)
                param.update(
                    layer=group_data['layer'],
                    layercounter=group_data['layercounter'],
                )
        return JsonResponse({'message': 'Layer elements saved successfully.'})
    else:
        return JsonResponse({'error': 'Invalid request method.'}, status=400)


import shutil

@login_required
def delete_account(request):
    if request.method == 'POST':
        user = request.user
        # CHECK FOR FILES TO REMOVE
        user_folder = str(user.id)  # Folder based on user ID             
        # Construct the full path to the folder to delete
        folder_path = os.path.join(settings.BASE_DIR, 'nodzapp','media', 'uploads', user_folder)
        # Check if the folder exists
        if os.path.exists(folder_path):
            # Delete the folder and all its contents (subdirectories and files)
            shutil.rmtree(folder_path)  
            print("Userdata deleted successfully.")
        else:
            print("Userdata does not exist.")

        deleted, _ = NodzUser.objects.filter(id=user.id).delete()   

        return JsonResponse({'message': 'Account successfully deleted.'})

@login_required
def delete_layer(request):
    if request.method == 'POST':
        user = request.user
        try:
            json_data = json.loads(request.body)
            logger.debug(f'Received JSON data: {json_data}')  # Log the JSON data    
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)
        # Save data to the database
        for group_data in json_data:
            layer_id = group_data.get('layerid') 
            if layer_id:
                layer_instance = Layer.objects.get(user=user, layer_id=layer_id) 
                # CHECK FOR FILES TO REMOVE
                user_folder = str(user.id)  # Folder based on user ID
                layer_folder = str(layer_id)  # Folder based on the layer number                
                # Construct the full path to the folder to delete
                folder_path = os.path.join(settings.BASE_DIR, 'nodzapp','media', 'uploads', user_folder, layer_folder)
                # Check if the folder exists
                if os.path.exists(folder_path):
                    # Delete the folder and all its contents (subdirectories and files)
                    shutil.rmtree(folder_path)  
                    print("Folder deleted successfully.")
                else:
                    print("Folder does not exist.")

                # CHECK FOR QUANTUM LINKS TO REMOVE
                nodes = Node.objects.filter(user=user, layer_id=layer_instance).values('quantum')
                for node in nodes:
                    quantum_data = json.loads(node['quantum'])
                    if quantum_data:
                        for item in quantum_data:
                            if "id" in item:
                                try:
                                    tunnel = Node.objects.get(user=user, node_id=item["id"])           
                                    tunnel.quantum = json.dumps([])  
                                    tunnel.save()
                                except Node.DoesNotExist:
                                    print(f"Node with id {item['id']} does not exist") 

                deleted, _ = Layer.objects.filter(user=user, layer_id=layer_id).delete()                
        return JsonResponse({'message': 'Layer successfully deleted.'})
    else:
        return JsonResponse({'error': 'Invalid request method.'}, status=400)

############################## NODES GESTION ##############################

@login_required
def save_node(request):
    if request.method == 'POST':
        user = request.user
        try:
            json_data = json.loads(request.body)
            logger.debug(f'Received JSON data: {json_data}')  # Log the JSON data
    
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)

        # Save data to the database
        for group_data in json_data:
          
            if 'id' in group_data:
                # print(user_id,group_data['id']),
                layer_instance, _ = Layer.objects.get_or_create(user=user, layer_id=group_data.get('layer', 1))
                node, created = Node.objects.get_or_create(
                    user=user, 
                    node_id=group_data['id'],
                    defaults={'layer': layer_instance}  # Ensure a default layer is provided
                )
                node = Node.objects.filter(user=user, node_id=group_data['id'])
                
                try:
                    # Query to retrieve the 'file' value
                    newfile = Node.objects.filter(user=user, node_id=group_data['id']).values('file')[0]['file']
                    print(newfile)

                    # Query to retrieve the 'preview' value
                    newpreview = Node.objects.filter(user=user, node_id=group_data['id']).values('preview')[0]['preview']
                except IndexError:
                    # Handle the case where no results are found
                    newfile = None
                    newpreview = None

                # Fetch layer by user and layer_id
                try:
                    layer_instance = Layer.objects.get(user=user, layer_id=group_data['layer'])
                except Layer.DoesNotExist:
                    return JsonResponse({'error': f'Layer {group_data["layer"]} does not exist for this user'}, status=400)

                node.update(
                    x_coordinate=group_data['x'],
                    y_coordinate=group_data['y'],
                    type=group_data['type'],
                    color=group_data['color'],
                    shape=group_data['shape'],
                    likes=group_data['likes'],
                    radius=group_data['radius'],
                    layer=layer_instance,
                    text_content=group_data['textContent'],
                    image_content=group_data['imgContent'],
                    video_link=group_data['videoLink'],
                    video_content=group_data['videoContent'],
                    canvas_content=group_data['canvasContent'],                 
                    file_name=group_data['fileName'],
                    file=newfile,
                    preview=newpreview,   
                    links=group_data['links'],
                    siblings=group_data['siblings'],
                    quantum=group_data['quantum'],
                    notification=group_data['notification'],
                    lock=group_data['lock'],
                    modified_at=timezone.localtime(timezone.now()),
                    archive = False,
                )

            elif 'linkid' in group_data:
                try:
                    layer_instance = Layer.objects.get(user=user, layer_id=group_data['layer'])
                except Layer.DoesNotExist:
                    return JsonResponse({'error': f'Layer {group_data["layer"]} does not exist for this user'}, status=400)

                print(group_data)
                link, created = Link.objects.get_or_create(user=user,link_id=group_data['linkid'],defaults={'layer': layer_instance})
                link = Link.objects.filter(user=user,link_id=group_data['linkid'])
                link.update(
                    linkA=group_data['linkA'],
                    linkB=group_data['linkB'],
                    layer=layer_instance,
                    user=user,
                    archive = False,
                )
            else:

                nodecounter = Node.objects.filter(user=user).aggregate(Max('node_id'))['node_id__max'] or 1
                linkcounter = Link.objects.filter(user=user).aggregate(Max('link_id'))['link_id__max'] or 1
                layercounter = Layer.objects.filter(user=user).aggregate(Max('layer_id'))['layer_id__max'] or 1

                user.nodescounter = Node.objects.filter(user=user,archive=False).count()
                user.save()
               
                Param.objects.get_or_create(user=user)
                param = Param.objects.filter(user=user)
                param.update(
                    originX=group_data['originX'],
                    originY=group_data['originY'],
                    nodecounter=nodecounter,
                    linkcounter=linkcounter,
                    layercounter=layercounter,
                    dark=group_data['dark'],
                    sound=group_data['sound'],
                    fullscreen=group_data['fullscreen'],
                    layer=group_data['layer'],
                )


        return JsonResponse({'message': 'Node element saved successfully.'})
    else:
        return JsonResponse({'error': 'Invalid request method.'}, status=400)
    
@login_required
def save_template(request):
    if request.method == 'POST':
        user = request.user
        try:
            json_data = json.loads(request.body)
            logger.debug(f'Received JSON data: {json_data}')     
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)

        # Save data to the database
        for group_data in json_data:          
            if 'id' in group_data:
                layer_instance, _ = Layer.objects.get_or_create(user=user, layer_id=group_data.get('layer', 1))
                Template.objects.get_or_create(user=user, template_id=group_data['id'],defaults={'layer': layer_instance})
                Template.objects.filter(user=user, template_id=group_data['id']).update(
                    x_coordinate=group_data['x'],
                    y_coordinate=group_data['y'],
                    type=group_data['type'],
                    lock=group_data['lock'],
                    size=group_data['size'],
                    layer=layer_instance,
                    archive=False,
                )
        return JsonResponse({'message': 'Template element saved successfully.'})
    else:
        return JsonResponse({'error': 'Invalid request method.'}, status=400)
    
    
@login_required
def save_quantum(request):
    if request.method == 'POST':
        user = request.user
        try:
            json_data = json.loads(request.body)
            logger.debug(f'Received JSON data: {json_data}')  # Log the JSON data
    
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)

        # Save data to the database
        for group_data in json_data:          
            if 'node' in group_data:
                node = Node.objects.filter(user=user, node_id=group_data['node']).first()
                print(node.quantum)
                if node:
                    quantum_str = node.quantum  # Get the JSON string from the database
                    try:
                        quantum_data = json.loads(quantum_str) if quantum_str else []
                    except json.JSONDecodeError:
                        quantum_data = []
      
                    # Ensure quantum_data is a list
                    if not isinstance(quantum_data, list):
                        quantum_data = []

                    # If quantum_data exists, update it; otherwise, create new entry
                    if quantum_data:
                        for item in quantum_data:
                            if isinstance(item, dict):  # Ensure item is a dictionary
                                item["layer"] = str(group_data['layer'])
                                item["node"] = "N-" + str(group_data['tunnelid'])
                    else:
                        quantum_data.append({
                            "node": "N-" + str(group_data['tunnelid']),
                            "layer": str(group_data['layer'])
                        })

                    # Save the updated JSON back to the database
                    node.quantum = json.dumps(quantum_data)  
                    node.save()

                    print("Updated quantum:", node.quantum)  # Debugging print
                    data = {
                    'update': {
                        'nodeid': node.node_id,
                        'quantum': node.quantum,
                    }}

                    return JsonResponse(data)
    else:
        return JsonResponse({'error': 'Invalid request method.'}, status=400)
    
@login_required
def delete_quantum(request):
    if request.method == 'POST':
        user = request.user
        try:
            json_data = json.loads(request.body)
            logger.debug(f'Received JSON data: {json_data}')  # Log the JSON data
    
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)

        # Save data to the database
        for group_data in json_data:          
            if 'id' in group_data:
                node = Node.objects.filter(user=user, node_id=group_data['id']).first()    
                if node:
                    # Reset quantum to an empty JSON array
                    node.quantum = json.dumps([])  
                    node.save()
                    return HttpResponse('Quantum deleted')
    else:
        return JsonResponse({'error': 'Invalid request method.'}, status=400)
    
@login_required
def delete (request):
    if request.method == 'POST':
        user = request.user
        try:
            json_data = json.loads(request.body)
            print(json_data)
            logger.debug(f'Received JSON data: {json_data}')  # Log the JSON data
    
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)

        # Save data to the database
        for group_data in json_data:
            
            if 'id' in group_data:
                node = Node.objects.filter(user=user, node_id=group_data['id'])
                node.update(
                    archive=True,
                )
            elif 'linkid' in group_data:
                link = Link.objects.filter(user=user, link_id=group_data['linkid'])
                link.update(
                    archive=True,
                )
            elif 'templateid' in group_data:
                template = Template.objects.filter(user=user, template_id=group_data['templateid'])
                template.update(
                    archive=True,
                )
        return JsonResponse({'message': 'Node elements deleted successfully.'})
    else:
        return JsonResponse({'error': 'Invalid request method.'}, status=400)

@login_required
def loading(request):
    if request.method == 'POST':
        user = request.user
        try:
            json_data = json.loads(request.body)
            logger.debug(f'Received JSON data: {json_data['layer']}')  
            if json_data['layer'] == 0: #Login
                layer = Param.objects.filter(user=user).values('layer').first()['layer']          
            elif json_data['layer'] == -1: #Register
                Param.objects.create(user=user)
                params = Param.objects.filter(user=user).values('originX', 'originY', 'layer', 'dark', 'sound', 'nodecounter', 'linkcounter','layercounter')
                formatted_params = []
                for param_name in ['originX', 'originY', 'layer', 'dark', 'sound', 'nodecounter', 'linkcounter', 'layercounter']:
                    if param_name in params[0]:  # Assuming there's at least one result
                        formatted_params.append({'name': param_name, 'value': params[0][param_name]})
                layer = Layer.objects.get(user=user)  
                data = {
                    'layers': {
                        'layerid': layer.layer_id,
                        'layername': layer.layer_name,
                    },
                    'params': formatted_params}
                return JsonResponse(data)
            else:
                layer = json_data['layer']
    
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)
      
        # Case login        
        formatted_profile = []
        formatted_profile.append({'name':'id', 'value': user.id})
        formatted_profile.append({'name':'admin', 'value': user.is_staff})
        formatted_profile.append({'name':'username', 'value': user.username})
        formatted_profile.append({'name':'premium', 'value': user.premium})
        formatted_date = user.date_joined.strftime('%Y-%m-%d %H:%M:%S') if user.date_joined else None
        formatted_profile.append({'name': 'date_joined', 'value': formatted_date})
        formatted_profile.append({'name':'email', 'value': user.email})
        formatted_profile.append({'name':'country', 'value': user.country})
        # age = datetime.now().date() - user.birthdate
        # formatted_profile.append({'name':'age', 'value': age.days // 365})
        formatted_profile.append({'name':'nodes', 'value': Node.objects.filter(user=user).count()})
        formatted_profile.append({'name':'text_nodes', 'value': Node.objects.filter(user=user,type='text',archive=False).count()})
        formatted_profile.append({'name':'image_nodes', 'value': Node.objects.filter(user=user,type='image',archive=False).count()})
        formatted_profile.append({'name':'file_nodes', 'value': Node.objects.filter(user=user,type='file',archive=False).count()})
        formatted_profile.append({'name':'video_nodes', 'value': Node.objects.filter(user=user,type='video',archive=False).count()})
        formatted_profile.append({'name':'sketch_nodes', 'value': Node.objects.filter(user=user,type='canvas',archive=False).count()})

        layer_instance = Layer.objects.get(user=user, layer_id=layer)                          
        # Retrieve all groups and link data from the database
        nodes = Node.objects.filter(user=user,archive=False, layer=layer_instance).values('node_id', 'x_coordinate', 'y_coordinate', 'layer__layer_id',
                                          'type', 'color','shape','likes', 'radius', 'rank', 'quantum',
                                          'text_content','image_content','canvas_content','video_content', 'video_link',
                                          'file','file_name', 'notification', 'lock')
        links = Link.objects.filter(user=user,archive=False,layer=layer_instance).values('link_id', 'linkA', 'linkB')
        templates = Template.objects.filter(user=user,archive=False,layer=layer_instance).values('template_id', 'x_coordinate', 'y_coordinate','type','lock','size')
        params = Param.objects.filter(user=user).values('originX', 'originY', 'layer', 'dark', 'sound', 'nodecounter', 'linkcounter','layercounter')
        formatted_params = []

        for param_name in ['originX', 'originY', 'layer', 'dark', 'sound', 'fullscreen', 'nodecounter', 'linkcounter', 'layercounter']:
            if param_name in params[0]:  # Assuming there's at least one result
                formatted_params.append({'name': param_name, 'value': params[0][param_name]})
        
        layers = Layer.objects.filter(user=request.user)    

        #Notifications
        # Compute the limit date
        one_week_from_now = datetime.now() + timedelta(weeks=1) 
        notifications = []
        for item in Node.objects.filter(user=user, archive=False).exclude(Q(notification='') | Q(notification__isnull=True)).values('notification', 'layer', 'node_id'):
            try:
                notification_date = parse_notification_date(item['notification'])
                if notification_date <= one_week_from_now:
                    notifications.append(item)
            except ValueError:
                # Handle any parsing errors if the format is invalid
                pass
 
        # Serialize the data into JSON format. Layer = 0 for login else just loading a layer
        if json_data['layer'] == 0:     
            data = {
                'layers': [
                    {
                        'layerid': layer.layer_id,
                        'layername': layer.layer_name,
                    }
                    for layer in layers
                ],
                'params': formatted_params,
                'nodes': list(nodes),
                'links': list(links), 
                'templates': list(templates), 
                'user': formatted_profile, 
                'notifications': list(notifications),         
            }
        else:
            data = {
                'nodes': list(nodes),
                'links': list(links),
                'templates': list(templates),   
            }
    
        # Return the JSON data as an HTTP response
        return JsonResponse(data)
    else:
        # Handle unsupported HTTP methods
        return JsonResponse({'error': 'Method not allowed'}, status=405)


from datetime import datetime, timedelta
from django.db.models import Q

def parse_notification_date(notification_text):
    """Parse text date format DD-MM-YYYY HH:MM to a datetime object."""
    return datetime.strptime(notification_text, "%d-%m-%Y %H:%M")

############################## PROFILE GET/SAVE ##############################

def get_profile(request):
    if request.method == 'POST':
        user = request.user
        formatted_profile = []
        formatted_profile.append({'name':'id', 'value': user.id})
        formatted_profile.append({'name':'username', 'value': user.username})
        formatted_profile.append({'name':'premium', 'value': user.premium})
        formatted_date = user.date_joined.strftime('%Y-%m-%d %H:%M:%S') if user.date_joined else None
        formatted_profile.append({'name': 'date_joined', 'value': formatted_date})
        formatted_profile.append({'name':'email', 'value': user.email})
        formatted_profile.append({'name':'country', 'value': user.country})
        age = datetime.now().date() - user.birthdate
        formatted_profile.append({'name':'age', 'value': age.days // 365})
        formatted_profile.append({'name':'nodes', 'value': Node.objects.filter(user=user).count()})
        formatted_profile.append({'name':'text_nodes', 'value': Node.objects.filter(user=user,type='text',archive=False).count()})
        formatted_profile.append({'name':'image_nodes', 'value': Node.objects.filter(user=user,type='image',archive=False).count()})
        formatted_profile.append({'name':'file_nodes', 'value': Node.objects.filter(user=user,type='file',archive=False).count()})
        formatted_profile.append({'name':'video_nodes', 'value': Node.objects.filter(user=user,type='video',archive=False).count()})
        formatted_profile.append({'name':'sketch_nodes', 'value': Node.objects.filter(user=user,type='canvas',archive=False).count()})
        data = {
            'profile': formatted_profile,   
        }
    
        # Return the JSON data as an HTTP response
        return JsonResponse(data)


def save_profile(request):
    if request.method == 'POST':
        user = request.user
        try:
            json_data = json.loads(request.body)
            logger.debug(f'Received JSON data: {json_data}')  # Log the JSON data
           
            if 'username' in json_data:
                user.username = json_data['username']
            elif 'email' in json_data:
                user.email = json_data['email']
            elif 'country' in json_data:
                user.country = json_data['country']
            user.save()

            return JsonResponse({'success': 'Saved to database'})
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)

        

############################## SEMANTIC SEARCH ##############################
    
def semantic_search(request):
    if request.method == 'POST':
        user = request.user
        try:
            json_data = json.loads(request.body)
            logger.debug(f'Received JSON data: {json_data}')  # Log the JSON data
    
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)

        search = json_data[0]['search']
 
        nodes = Node.objects.filter(user=user,archive=False).values('node_id','layer__layer_id','text_content','video_content','image_content','file_name','file_text_content','created_at','modified_at')
        ranked_nodes = []
        for node in nodes:
            # Calculate matching score based on criteria
            matching_score = calculate_matching_score(node, search)

            # Append node with matching score to ranked_nodes list
            ranked_nodes.append({
                'id': node.get('node_id'),
                'layer': node.get('layer__layer_id'),
                'matching_score': matching_score
            })

        # Sort ranked nodes based on matching score (descending order)
        ranked_nodes.sort(key=lambda x: x['matching_score'], reverse=True)
  
        # Serialize ranked nodes to JSON and return as response
        return JsonResponse({'ranked_nodes': ranked_nodes})

    else:
        return JsonResponse({'error': 'Invalid request method.'}, status=400)
    


def calculate_matching_score(node, criteria):
    # Convert strings to lowercase for case-insensitive comparison + Decode HTML entities
    criteria = html.unescape(criteria.lower())
    # Extract text content and ensure it is not None before lowercasing
    textcontent = html.unescape(node.get('text_content', '').lower()) if node.get('text_content') is not None else ''
    filename = node.get('file_name', '').lower() if node.get('file_name') is not None else ''
    filetextcontent = node.get('file_text_content', '').lower() if node.get('file_text_content') is not None else ''
    videocontent = node.get('video_content', '').lower() if node.get('video_content') is not None else ''
    imagecontent = node.get('image_content', '').lower() if node.get('image_content') is not None else ''

    # Extract created_at and modified_at, handle None values
    created = node.get('created_at')
    modified = node.get('modified_at')
    
    # Tokenize strings into sets of words for faster lookup
    criteria_words = set(criteria.split())
    node_words = set(textcontent.split())
    filename_words = set(filename.split())
    file_words = set(filetextcontent.split())
    video_words = set(videocontent.split())
    image_words = set(imagecontent.split())
    # Initialize an empty set for search_list
    search_list = set()

    # Add node_words, imagecontent, filename, and file_words to search_list
    search_list.update(node_words)
    search_list.update(filename_words)
    search_list.update(video_words)
    search_list.update(image_words)
  
    # print('criteria_words',criteria_words)
    # print('node_words',node_words)
    # print('file_words',file_words)
    # print('filename',filename)
    # Find matches between criteria words and words in node content
    matches = set()
    # Initialize score counter
    score = 0
    for word in search_list:
        if any(criterion in word for criterion in criteria_words):
            matches.add(word)
            score += 10
            print(node,word)
    
    search_list = set()
    search_list.update(file_words)

    for word in search_list:
        if any(criterion in word for criterion in criteria_words):
            matches.add(word)
            score += 1
    # Print or return matches based on your requirement
    # print(matches)
    return score

    # # Calculate number of perfect complete word matches
    # perfect_matches = sum(1 for word in criteria_words if word in node_words)

    # # Calculate matching score based on perfect matches and criteria length
    # if len(criteria_words) > 0:
    #     matching_score = perfect_matches / len(criteria_words)
    # else:
    #     matching_score = 0

    # return matching_score


############################## FILE HANDLING ##############################

from django.conf import settings
import os

############################## UPLOAD
import threading

def upload_file(request):

    if request.method == 'POST' and request.FILES.get('file'):    
        user = request.user
        nodeID = request.POST.get('nodeID')
        fileName = request.POST.get('fileName')
        layer = request.POST.get('layer')
        uploaded_file = request.FILES['file']
        filetype = get_file_type_from_extension(uploaded_file.name)
        # node = Node.objects.get_or_create(user=user, node_id=nodeID)[0]
        layer_instance, _ = Layer.objects.get_or_create(user=user, layer_id=layer)
        node, created = Node.objects.get_or_create(
            user=user, 
            node_id=nodeID,
            defaults={'layer': layer_instance}  # Ensure a default layer is provided
        )
        node.file = uploaded_file  # Update the file field of the Node object
        node.file_name = fileName
        node.type = 'file'
        node.save()  
    
        if filetype == 'PDF Document':
            pdf_filepath = node.file.path 
            # Start background thread
            thread = threading.Thread(target = extract_text_from_pdf,args=(node.file.path,user,nodeID))
            thread.start()           
                            
        elif filetype == 'Word Document':

            text_content = extract_text_from_docx(node.file.path)
            directory = os.path.dirname(node.file.path)
            # Generate the output PDF file path
            pdf_file_name = os.path.splitext(os.path.basename(node.file.path))[0] + ".pdf"
            pdf_filepath = os.path.join(directory, pdf_file_name)
            convert_docx_to_pdf(node.file.path, pdf_filepath)

        elif filetype == 'Excel Spreadsheet':

            text_content = extract_text_from_excel(node.file.path)
            directory = os.path.dirname(node.file.path)
      
            logo_path = os.path.join(settings.BASE_DIR, 'nodzapp', 'static', 'img', 'excel.svg')
            return FileResponse(open(logo_path, "rb"), content_type="image/svg+xml")
                   
        
           
        elif filetype == 'PowerPoint Presentation':

            text_content = extract_text_from_pptx(node.file.path)
            directory = os.path.dirname(node.file.path)
            # Generate the output PDF file path
            pdf_file_name = os.path.splitext(os.path.basename(node.file.path))[0] + ".pdf"
            pdf_filepath = os.path.join(directory, pdf_file_name)
            convert_pptx_to_pdf(node.file.path, pdf_filepath)

        # elif filetype == 'JPEG Image' or filetype == 'PNG Image':
        #     directory = os.path.dirname(node.file.path)

        #     file_path = os.path.join(directory, fileName)
        #     print(f"Attempting to open file: {file_path}")

        #     return FileResponse(open(file_path, "rb"), content_type="image/svg+xml")
            
        elif filetype == 'STL Model':       

            text_content = '3D STL' + fileName
            directory = os.path.dirname(node.file.path)
            f = open(node.file.path, 'rb')
            node.preview = node.file.path
            node.file_text_content = text_content
            node.save()    
            return FileResponse(f, content_type='application/stl')           

        else:
            
            logo_path = os.path.join(settings.BASE_DIR, 'nodzapp', 'static', 'img', 'file.svg')
            return FileResponse(open(logo_path, "rb"), content_type="image/svg+xml")     
        

        node.preview = pdf_filepath
        # node.file_text_content = text_content
        node.save()    
 
        try:
            f = open(pdf_filepath, 'rb')
            return FileResponse(f, content_type='application/pdf') 
        
        
        except FileNotFoundError:
            return HttpResponse("PDF not found", status=404)

    return HttpResponse("No file uploaded.")


############################## LOAD FILE

def load_file(request):
    if request.method == 'POST':
        json_data = json.loads(request.body)
        if 'nodeID' in json_data:
            user = request.user
            nodeID = json_data.get('nodeID')  
            fileName = json_data.get('fileName')
        
        filetype = get_file_type_from_extension(fileName)

        directory = Node.objects.filter(user=user,node_id=nodeID, file_name = fileName).values('preview').first()
        preview_path = directory['preview']
    
        try:
            f = open(preview_path, 'rb')
            if filetype == 'STL Model':
                return FileResponse(f, content_type='application/stl')
            else:
                return FileResponse(f, content_type='application/pdf')
        
        except FileNotFoundError:
            return HttpResponse("File not found", status=404)

    return HttpResponse("Network error.")

############################## DOWNLOAD

from django.http import FileResponse

def download_file(request):
    if request.method == 'POST':
        try:
            # Parse the JSON data from the request body
            data = json.loads(request.body)
            tag_name = data.get('tagName') 
            id = data.get('id')  
            userID = request.user.id
            print({'tagName': tag_name, 'id':id, 'userid':userID})

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)
          
        # Retrieve the file object
        uploaded_file = Node.objects.filter(file_name=tag_name,node_id=id,user_id=userID)[0]
       
        if uploaded_file:
            # Get the file path from the UploadedFile object
            file_path = uploaded_file.file.path
            # Open the file in binary mode
            file = open(file_path, 'rb')
            # Return the file as an HTTP response
            response = FileResponse(file)
            return response
        
        else:
            # Handle case where file does not exist
            return JsonResponse({'error': 'File not found'}, status=404)
    else:
        # Handle unsupported HTTP methods
        return JsonResponse({'error': 'Method not allowed'}, status=405)



def get_file_type_from_extension(filename):
    # Dictionary mapping file extensions to file types
    file_types = {
        'doc': 'Word Document',
        'docx': 'Word Document',
        'ppt': 'PowerPoint Presentation',
        'pptx': 'PowerPoint Presentation',
        'pdf': 'PDF Document',
        'xls': 'Excel Spreadsheet',
        'xlsx': 'Excel Spreadsheet',
        'xlsm': 'Excel Spreadsheet',
        'csv': 'CSV File',
        'jpg': 'JPEG Image',
        'png': 'PNG Image',
        'stl': 'STL Model',
        # Add more file types as needed
    }
    # Get the file extension from the filename
    extension = filename.split('.')[-1].lower()
    
    # Lookup the file type in the dictionary
    file_type = file_types.get(extension, 'Unknown')
    print(file_type)
    
    return file_type

# File is a pdf

import PyPDF2

def extract_text_from_pdf(pdf_path,user,nodeID):
    text_content = ""
    with open(pdf_path, "rb") as f:
        pdf_reader = PyPDF2.PdfReader(f)
        num_pages = len(pdf_reader.pages)
        for page_number in range(num_pages):
            page = pdf_reader.pages[page_number]
            text_content += page.extract_text() 
    node = Node.objects.get(user=user, node_id=nodeID)
    node.file_text_content = text_content
    node.save()    

# File is a docx

from docx import Document

def extract_text_from_docx(docx_path):
    doc = Document(docx_path)
    text_content = '\n'.join([paragraph.text for paragraph in doc.paragraphs])
    return text_content

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import os

def convert_docx_to_pdf(docx_path, pdf_path):
    # Load the DOCX file
    doc = Document(docx_path)
    # Create a PDF canvas
    c = canvas.Canvas(pdf_path, pagesize=letter)
    width, height = letter
    # Initial Y position
    y_position = height - 50  # Start from near the top
    # Font settings
    c.setFont("Helvetica", 12)
    # Read paragraphs from DOCX and write to PDF
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            c.drawString(50, y_position, text)
            y_position -= 20  # Move down for the next line
        # Check for new page
        if y_position < 50:
            c.showPage()  # Create a new page
            c.setFont("Helvetica", 12)
            y_position = height - 50  # Reset Y position

    # Save the PDF
    c.save()
    print(f"PDF saved at: {os.path.abspath(pdf_path)}")




# File is a xls

import openpyxl

def extract_text_from_excel(excel_path):
    text_content = ''
    wb = openpyxl.load_workbook(excel_path)
    for sheet_name in wb.sheetnames:
        sheet = wb[sheet_name]
        for row in sheet.iter_rows(values_only=True):
            text_content += ' '.join(str(cell) for cell in row if cell) + '\n'
    return text_content

    
# File is a ppt

from pptx import Presentation

# from Convert2PDF.ConvertToPDF import docx2pdfConvert, pptx2pdfConvert, img2pdfConvert, bmp2pdfConvert, txt2pdfConvert, mergePdfs

# def convert_pptx_to_pdf(pptx_path, output_path):
#     pptx2pdfConvert(pptx_path, output_path)


def extract_text_from_pptx(pptx_path):
    text = ''
    # presentation = Presentation(pptx_path)
    # for slide in presentation.slides:
    #     for shape in slide.shapes:
    #         if hasattr(shape, "text"):
    #             text += shape.text + '\n'
    return text


import aspose.slides as slides


def oldconvert_pptx_to_pdf(input_path, output_pdf_path):
    # Load the PowerPoint presentation
    presentation = slides.Presentation(input_path)
    
    # Save it as a PDF
    presentation.save(output_pdf_path, slides.export.SaveFormat.PDF)


import subprocess

def convert_pptx_to_pdf(input_path, output_pdf_path):
    try:
        # Command to convert PPTX to PDF using LibreOffice in headless mode
        subprocess.run(['libreoffice', '--headless', '--convert-to', 'pdf', '--outdir', os.path.dirname(output_pdf_path), input_path], check=True)
        print(f"PDF successfully created at {output_pdf_path}")
    except subprocess.CalledProcessError as e:
        print(f"Error during conversion: {e}")

############################## YOUTUBE HANDLING ##############################

import requests
from bs4 import BeautifulSoup

def YTsearch(request):
 
    query = json.loads(request.body)
    # Construct YouTube search URL
    youtube_url = 'https://www.youtube.com/results?search_query=' + query
    # Send GET request to YouTube
    response = requests.get(youtube_url)
    if response.status_code == 200:
        # Parse HTML content
        soup = BeautifulSoup(response.content, 'html.parser')
        html_content = str(soup)
        # Find all script tags containing JSON data
        json_strings = re.findall(r'{"videoId":"(.*?)"', str(response.content))
     
        video_ids = ['v='+json_string for json_string in json_strings]

        
        # Return the extracted video IDs as a JSON response
        return JsonResponse({'video_ids': video_ids})
    
    else:
        # Return an error response if the request fails
        return JsonResponse({'error': 'Failed to fetch YouTube search results'}, status=500)




############################## VIEWS DISPATCHER ##############################

def privacy(request): 
    return render(request, "privacy.html")

def terms(request): 
    return render(request, "terms.html")

def contact(request): 
    return render(request, "contact.html")

from django.contrib.auth import logout
def universe(request):   
    r_id = request.GET.get('r')
    context = {'r': r_id} 
    logout(request)
    return render(request, "universe.html", context)

def referree(request, r_id):
    try:
        referrer = NodzUser.objects.get(id=r_id)        
        # Redirect the user to /you/ with the r_id as a query parameter
        return redirect(f'/universe?r={r_id}')
    except NodzUser.DoesNotExist:
        return HttpResponse('Referrer not found.', status=404)

from datetime import date
def referrer(request):
    if request.method == 'POST':    
        user = request.user
        try:
            json_data = json.loads(request.body)
            logger.debug(f'Received JSON data: {json_data}')  # Log the JSON data

        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)

        # Save data to the database
        for group_data in json_data:
            
            if 'referrer' in group_data:

                referrer_id = group_data['referrer']
                print(user.id,referrer_id)
                # Validate referrer_id
                if not referrer_id or not referrer_id.isdigit():
                    return JsonResponse({"error": "Invalid referrer ID"}, status=400)

                # Get user & referrer safely
                referree = get_object_or_404(NodzUser, id=user.id)
                referrer = get_object_or_404(NodzUser, id=int(referrer_id))

                if referree and referrer:
                    referree.referrer = referrer_id
                    referrer.referree_points += 1

                    try:
                        json_data = json.loads(referrer.referrees) if referrer.referrees else []
                    except json.JSONDecodeError:
                        json_data = []
            
                    if not isinstance(json_data, list):
                        json_data = []
                    
                    if json_data:
                        today = date.today() 
                        json_data.append({str(today): str(referree.id)})

                    # Save the updated JSON back to the database
                    referrer.referrees = json.dumps(json_data)  
                    referrer.save()  
                    referree.save()  

                    return JsonResponse({"message": "Referrer updated successfully!"})

    return JsonResponse({"error": "Invalid request"}, status=400)
     


def test(request): 
    return render(request, "test.html")




############################## PAYMENT ##############################

from django.views.decorators.csrf import csrf_exempt  # Needed to handle POST requests without CSRF tokens (for APIs)
from django.conf import settings  # Access to Stripe API keys in settings.py
import stripe

# Set your secret key from settings
stripe.api_key = settings.STRIPE_SECRET_KEY

@csrf_exempt  # Stripe usually sends POST requests, which can require CSRF exemption
def process_payment(request):
    if request.method == 'POST':
        try:
            # Get the plan (e.g., 'monthly' or 'yearly') from the request body
            plan = request.POST.get('plan')  # Or request.body with JSON if using a frontend that sends JSON
            
            # Determine the price based on the plan selected
            price = 1000 if plan == 'monthly' else 10000  # In cents (e.g., $10 or $100)
            
            # Create a payment intent using Stripe API
            intent = stripe.PaymentIntent.create(
                amount=price,
                currency='usd',
                payment_method_types=['card'],  # Accept credit cards
            )
            
            # Return the client secret needed to complete the payment
            return JsonResponse({'client_secret': intent.client_secret})
        
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=403)
    
    return JsonResponse({'error': 'Invalid request method'}, status=405)


@login_required
def cancel_subscription(request):
    if request.method == 'POST':
        # Get the currently logged-in user
        user = request.user

        if not user.is_premium:
            return JsonResponse({'error': 'User is not subscribed to any premium plan.'}, status=400)

        # Cancel the Stripe subscription
        try:
            stripe.Subscription.delete(user.stripe_subscription_id)
            user.is_premium = False  # Update the user status to non-premium
            user.stripe_subscription_id = None  # Clear subscription ID
            user.save()  # Save the changes to the database
            return JsonResponse({'status': 'Subscription canceled successfully'})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    
    # If not a POST request, return an error
    return JsonResponse({'error': 'Invalid request method'}, status=405)


############################## CONTACT ##############################


from django.core.mail import send_mail
from django.shortcuts import render
from django.conf import settings
from .forms import ContactForm
from django.contrib import messages

def feedback(request):
    if request.method == 'POST':
        form = ContactForm(request.POST)
        if form.is_valid():
            # Get form data
            name = form.cleaned_data['name']
            email = form.cleaned_data['email']
            message = form.cleaned_data['message']

            # Send email
            try:
                send_mail(
                    f"New Contact Form Message from {name}",
                    f"Name: {name}\nEmail: {email}\nMessage: {message}",
                    settings.DEFAULT_FROM_EMAIL,
                    ['recipient-email@example.com'],  # Change this to your own email address
                    fail_silently=False,
                )
                messages.success(request, "Your message has been sent successfully!")
                return redirect('contact')
            except Exception as e:
                messages.error(request, f"Error: {e}")
        else:
            messages.error(request, "There was an error with your form.")
    else:
        form = ContactForm()

    return render(request, 'contact.html', {'form': form})


############################## MULTI-USERS ##############################

from django.shortcuts import get_object_or_404, redirect
from django.http import JsonResponse
from django.utils import timezone
from .models import Node, Invite
from django.urls import reverse
from django.db.models import Q


@login_required
def generate_invite(request, node_ids):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'User must be logged in'}, status=403)

    user = request.user
    params = Param.objects.filter(user=user)
    # Parse node_ids and validate nodes belong to the user
    node_ids = node_ids.split(',')
    nodes = Node.objects.filter(user=user, node_id__in=node_ids)
    # Get related links
    links = Link.objects.filter(Q(user=user) & (Q(linkA__in=node_ids) | Q(linkB__in=node_ids)))

    if not nodes.exists():
        return JsonResponse({'error': 'No valid nodes selected'}, status=404)

    invite = Invite.objects.create(
        invited_by=request.user,
        expires_at=timezone.now() + timezone.timedelta(days=1),  # 1-day expiry
        max_access=5
    )
    invite.params.set(params)
    invite.nodes.set(nodes)
    invite.links.set(links)

    # Generate the link
    invite_link = request.build_absolute_uri(reverse('invite_access', args=[invite.token]))
    return JsonResponse({'invite_link': invite_link})


from django.shortcuts import redirect, get_object_or_404
from django.http import JsonResponse
from django.utils import timezone
from .models import Invite  # Ensure the Invite model is imported

@login_required
def invite_access(request, token):
    # Validate the invite token
    invite = get_object_or_404(Invite, token=token)

    # Check if the invite is still valid
    if invite.expires_at < timezone.now():
        return JsonResponse({'error': 'Invite link has expired'}, status=403)

    # Check if max access has been reached
    if invite.access_count >= invite.max_access:
        return JsonResponse({'error': 'Invite link has reached maximum access count'}, status=403)

    # Increment access count and save
    invite.access_count += 1
    print('invite',invite.access_count)
    invite.save()

    # Redirect to the you page with the token in the URL
    return redirect(f"{reverse('universe')}?token={token}")

def shared_nodes(request):
    token = request.GET.get('token')
    
    if token:
        # Fetch the invite object based on the token
        invite = get_object_or_404(Invite, token=token)

        # Fetch nodes based on token
        # nodes = invite.nodes.exclude(privacy=2)
        node_data = [{
            'node': node.node_id,
            'x_coordinate': node.x_coordinate,
            'y_coordinate': node.y_coordinate,
            'type': node.type,
            'color': node.color,
            'radius': node.radius,
            'layer': node.layer,
            'rank': node.rank,
            'links': node.links,
            'quantum': node.quantum,
            'text_content': node.text_content,
            'image_content': node.image_content.url if node.image_content else '',
            'canvas_content': node.canvas_content,
            'video_content': node.video_content,
            'video_link': node.video_link,
            'file_name': node.file_name,
            'notification': node.notification,
            'lock': node.lock,
            'shape': node.shape,
            'likes': node.likes,
        } for node in invite.nodes.all()]

        link_data = [{
            'link': link.link,
            'linkA': link.linkA,
            'linkB': link.linkB,
        } for link in invite.links.all()]

        params_data = list(invite.params.values(
            'rootX', 'rootY', 'layer', 'dark', 'sound', 
            'nodecounter', 'linkcounter', 'layercounter'
        ))
        data = {
            'nodes': node_data,
            'links': link_data,
            'params': params_data,
        }
        return JsonResponse(data)
    return JsonResponse({'error': 'Invalid token'}, status=404)


@login_required
def generate_invite(request, node_ids):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'User must be logged in'}, status=403)

    user = request.user
    params = Param.objects.filter(user=user)
    # Parse node_ids and validate nodes belong to the user
    node_ids = node_ids.split(',')
    nodes = Node.objects.filter(user=user, node_id__in=node_ids)
    # Get related links
    links = Link.objects.filter(Q(user=user) & (Q(linkA__in=node_ids) | Q(linkB__in=node_ids)))

    if not nodes.exists():
        return JsonResponse({'error': 'No valid nodes selected'}, status=404)

    invite = Invite.objects.create(
        invited_by=request.user,
        expires_at=timezone.now() + timezone.timedelta(days=1),  # 1-day expiry
        max_access=5
    )
    invite.params.set(params)
    invite.nodes.set(nodes)
    invite.links.set(links)

    # Generate the link
    invite_link = request.build_absolute_uri(reverse('invite_access', args=[invite.token]))
    return JsonResponse({'invite_link': invite_link})

############################## SECURE FILE DOWNLOAD OUTSIDE Nod-Z ##############################
from itsdangerous import URLSafeTimedSerializer
from django.shortcuts import get_object_or_404
from django.http import FileResponse, Http404
SECRET_KEY = settings.SECRET_KEY  # Use Django's secret key
serializer = URLSafeTimedSerializer(SECRET_KEY)
from django.contrib.sites.shortcuts import get_current_site

@login_required
def generate_download_link(request,node_id, filename):
    """Generate a secure, encrypted download link"""
    data = {"user_id": request.user.id, "node_id": node_id}  
    token = serializer.dumps(data)  # Encrypt sensitive data
    current_site = get_current_site(request)  # Get the current domain (e.g., 127.0.0.1:8000)
    site_url = f"http://{current_site.domain}"
    secure_link = f"{site_url}/get-file/{token}/{filename}"
    logger.info(f"Generated download link: {secure_link}")
    return JsonResponse({"download_url": secure_link})

def get_file(request, token, filename):
    """Decrypt token & serve the file if valid"""
    try:
        data = serializer.loads(token)
        user_id = data["user_id"]
        node_id = data["node_id"]

        # Construct the file path (assuming a structure based on user & node)
        uploaded_file = Node.objects.filter(file_name=filename,node_id=node_id,user_id=user_id)[0]
        file_path = uploaded_file.file.path

        if os.path.exists(file_path):
            return FileResponse(open(file_path, 'rb'), as_attachment=True)
        else:
            raise Http404("File not found")
    except Exception:
        raise Http404("Invalid or expired link")


############################## VERIFY EMAIL ##############################

# Global dictionary to store validation codes temporarily (in memory)
validation_codes = {}

# View to send the validation code to the user's email
@csrf_exempt
def send_validation_code(request):
    if request.method == 'POST':
        email = request.POST.get('email')
        
        if not email:
            return JsonResponse({'error': 'Email is required'}, status=400)

        # Generate a random 6-digit validation code
        validation_code = str(random.randint(100000, 999999))

        # Store it temporarily in memory (use a database for production)
        validation_codes[email] = validation_code

        # Send email to the user with the validation code
        send_mail(
            'Your Validation Code',
            f'Your validation code is: {validation_code}',
            'no-reply@yourdomain.com',
            [email],
            fail_silently=False,
        )

        return JsonResponse({'status': 'Validation code sent'})
    return JsonResponse({'error': 'Invalid request method'}, status=405)

# View to verify the code entered by the user
@csrf_exempt
def verify_validation_code(request):
    if request.method == 'POST':
        email = request.POST.get('email')
        code = request.POST.get('code')

        if not email or not code:
            return JsonResponse({'error': 'Email and code are required'}, status=400)

        # Check if the code matches the one we stored
        if validation_codes.get(email) == code:
            if NodzUser.objects.filter(email=email).exists():
                return JsonResponse({'error': 'This email is already used'},status=400)
            return JsonResponse({'status': 'Code is correct!'})
        else:
            return JsonResponse({'error': 'Invalid code'}, status=400)

    return JsonResponse({'error': 'Invalid request method'}, status=405)

############################## SUBMIT FEEDBACK ##############################

@login_required
def submit_feedback(request):
    if request.method == "POST":
        data = json.loads(request.body)
        message_content = data[0].get('message')
        if message_content:
            # Create and save the feedback message
            feedback = Feedback.objects.create(
                user=request.user if request.user.is_authenticated else None,  # Associate with logged-in user if available
                message=message_content
            )
            return JsonResponse({'status': 'success', 'message': 'Feedback submitted successfully.'})
        else:
            return JsonResponse({'status': 'error', 'message': 'Message content is required.'}, status=400)
    return JsonResponse({'status': 'error', 'message': 'Invalid request.'}, status=400)


############################## ADMIN ##############################

@login_required  # Ensures user is logged in before accessing
def admin_users(request):
    if request.method == "POST":
        user = request.user
        if user.is_staff: 
            users = NodzUser.objects.all().values(
                'id', 'username', 'country', 'email', 'date_joined', 'premium', 'nodescounter', 'referree_points'
            )
            formatted_users = []
            for user in users:
                user['date_joined'] = user['date_joined'].strftime('%Y-%m-%d')  # Trim to YYYY-MM-DD
                formatted_users.append(user)
            data = {
                'users': list(formatted_users),  
            }    
            return JsonResponse(data)
        else:
            return JsonResponse({'status': 'error', 'message': 'Admin access required.'}, status=403)

    return JsonResponse({'status': 'error', 'message': 'Invalid request method. Use POST.'}, status=405)



@login_required
def admin_loading(request):
    if request.method == 'POST':
        if not request.user.is_staff:
            return JsonResponse({'error': 'User not allowed'}, status=405)
        try:
            json_data = json.loads(request.body)        
            userID = json_data['userID']
            user = NodzUser.objects.get(id=userID) 
            layer = json_data['layer']
    
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)
            
        formatted_profile = []
        formatted_profile.append({'name':'id', 'value': user.id})
        formatted_profile.append({'name':'admin', 'value': user.is_staff})
        formatted_profile.append({'name':'username', 'value': user.username})
        formatted_profile.append({'name':'premium', 'value': user.premium})
        formatted_date = user.date_joined.strftime('%Y-%m-%d %H:%M:%S') if user.date_joined else None
        formatted_profile.append({'name': 'date_joined', 'value': formatted_date})
        formatted_profile.append({'name':'email', 'value': user.email})
        formatted_profile.append({'name':'country', 'value': user.country})
        formatted_profile.append({'name':'nodes', 'value': Node.objects.filter(user=user).count()})
        formatted_profile.append({'name':'text_nodes', 'value': Node.objects.filter(user=user,type='text',archive=False).count()})
        formatted_profile.append({'name':'image_nodes', 'value': Node.objects.filter(user=user,type='image',archive=False).count()})
        formatted_profile.append({'name':'file_nodes', 'value': Node.objects.filter(user=user,type='file',archive=False).count()})
        formatted_profile.append({'name':'video_nodes', 'value': Node.objects.filter(user=user,type='video',archive=False).count()})
        formatted_profile.append({'name':'sketch_nodes', 'value': Node.objects.filter(user=user,type='canvas',archive=False).count()})

        layer_instance = Layer.objects.get(user=user, layer_id=layer)                          
        # Retrieve all groups and link data from the database
        nodes = Node.objects.filter(user=user,archive=False, layer=layer_instance).values('node_id', 'x_coordinate', 'y_coordinate', 'layer__layer_id',
                                          'type', 'color','shape','likes', 'radius', 'rank', 'quantum',
                                          'text_content','image_content','canvas_content','video_content', 'video_link',
                                          'file','file_name', 'notification', 'lock')
        links = Link.objects.filter(user=user,archive=False,layer=layer_instance).values('link_id', 'linkA', 'linkB')
        templates = Template.objects.filter(user=user,archive=False,layer=layer_instance).values('template_id', 'x_coordinate', 'y_coordinate','type','lock','size')
        params = Param.objects.filter(user=user).values('originX', 'originY', 'layer', 'dark', 'sound', 'nodecounter', 'linkcounter','layercounter')
        formatted_params = []

        for param_name in ['originX', 'originY', 'layer', 'dark', 'sound', 'fullscreen', 'nodecounter', 'linkcounter', 'layercounter']:
            if param_name in params[0]:  # Assuming there's at least one result
                formatted_params.append({'name': param_name, 'value': params[0][param_name]})
        
        layers = Layer.objects.filter(user=request.user)    

        #Notifications
        # Compute the limit date
        one_week_from_now = datetime.now() + timedelta(weeks=1) 
        notifications = []
        for item in Node.objects.filter(user=user, archive=False).exclude(Q(notification='') | Q(notification__isnull=True)).values('notification', 'layer', 'node_id'):
            try:
                notification_date = parse_notification_date(item['notification'])
                if notification_date <= one_week_from_now:
                    notifications.append(item)
            except ValueError:
                # Handle any parsing errors if the format is invalid
                pass
 
        # Serialize the data into JSON format. Layer = 0 for login else just loading a layer
        if json_data['layer'] == 0:     
            data = {
                'layers': [
                    {
                        'layerid': layer.layer_id,
                        'layername': layer.layer_name,
                    }
                    for layer in layers
                ],
                'params': formatted_params,
                'nodes': list(nodes),
                'links': list(links), 
                'templates': list(templates), 
                'user': formatted_profile, 
                'notifications': list(notifications),         
            }
        else:
            data = {
                'nodes': list(nodes),
                'links': list(links),
                'templates': list(templates),   
            }
    
        # Return the JSON data as an HTTP response
        return JsonResponse(data)
    else:
        # Handle unsupported HTTP methods
        return JsonResponse({'error': 'Method not allowed'}, status=405)

