from django.db import models
from django.contrib.auth.models import AbstractUser
from django.contrib.auth.models import BaseUserManager
from django.db.models import Max
from django.utils import timezone
import datetime
import os


# Convert to UTC timezone
utc_now = timezone.localtime(timezone.now())

class NodzUserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('The Email field must be set')
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)

        if not email:
            raise ValueError('Superuser must have an email address.')

        return self.create_user(email, password, **extra_fields)

class NodzUser(AbstractUser):
    # Update email field with unique constraint
    email = models.EmailField(
        verbose_name='email address',
        max_length=254,
        unique=True,  
        blank=True,
    )
    username = models.CharField(
        max_length=254,
        unique=False,  
        blank=True,
    )
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []

    objects = NodzUserManager()
    nodescounter = models.IntegerField(default=0)
    birthdate = models.DateField(null=True, blank=True, default=datetime.date.today)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    country = models.CharField(max_length=2,null=True, blank=True)

    premium = models.BooleanField(default=False)
    premium_date = models.DateTimeField(null=True, blank=True)
    premium_type = models.CharField(max_length=2, null=True, blank=True)
    premium_days = models.IntegerField(default=0)
    # stripe_subscription_id = models.CharField(max_length=255, null=True, blank=True)

    verifcode = models.IntegerField(default=0)
    referrer = models.IntegerField(default=0)
    referrees = models.TextField(default='')
    referree_points = models.IntegerField(default=0)
                 
    def save(self, *args, **kwargs):
        if not self.id:
            self.date_joined = timezone.localtime(timezone.now())
        return super().save(*args, **kwargs)

    class Meta:
        ordering = ['nodescounter']


class Param(models.Model):
    user = models.ForeignKey('NodzUser', on_delete=models.CASCADE, null=True)
    layer = models.IntegerField(default=1)
    originX = models.FloatField(default=0)
    originY = models.FloatField(default=0)
    nodecounter = models.IntegerField(default=0)
    linkcounter = models.IntegerField(default=0)
    layercounter = models.IntegerField(default=1)
    sound = models.BooleanField(default=False)
    dark = models.BooleanField(default=True)
    fullscreen = models.BooleanField(default=False)

class Layer(models.Model):
    user = models.ForeignKey('NodzUser', on_delete=models.CASCADE)  # Ensures cascading deletion
    layer_id = models.PositiveIntegerField()  # Sequential numbering per user  
    layer_name = models.TextField(default='')  

    class Meta:
        unique_together = ('user', 'layer_id')  # Ensure unique layer numbers per user

    def save(self, *args, **kwargs):
        """ Automatically assign a sequential layer_id for each user """
        if not self.layer_id:
            max_layer = Layer.objects.filter(user=self.user).aggregate(Max('layer_id'))['layer_id__max']
            self.layer_id = (max_layer or 0) + 1  # Next available layer number
        super().save(*args, **kwargs)
    
    def __str__(self):
        return f"Layer {self.layer_id} (User {self.user.id})"



def user_layer_upload_to(instance,name):
    # Use `instance.node_id` as the dynamic layer folder name
    user_folder = str(instance.user.id)  # User ID folder
    layer_folder = str(instance.layer.layer_id)
    filename = str(instance.file_name)
    
    # Construct the full file path with user and layer-based structure
    return os.path.join('uploads', user_folder, layer_folder, filename)


class Node(models.Model):
    user = models.ForeignKey('NodzUser', on_delete=models.CASCADE)
    node_id = models.PositiveIntegerField(default=1)
    x_coordinate = models.FloatField(default=0)
    y_coordinate = models.FloatField(default=0)
    layer = models.ForeignKey(Layer, on_delete=models.CASCADE, related_name="nodes")
    rank = models.PositiveIntegerField(default=0)
    type = models.CharField(max_length=50,default='text')  
    color = models.CharField(max_length=20,default='#33FF99')
    shape = models.TextField(default='circle')
    likes = models.IntegerField(default=0)
    radius = models.FloatField(default=0)
    links = models.TextField(default='')
    siblings = models.TextField(default='')
    quantum = models.TextField(default='')
    lock = models.BooleanField(default=False)
    
    # Additional fields based on node type
    text_content = models.TextField(null=True, blank=True)
    image_content = models.ImageField(upload_to=user_layer_upload_to, null=True, blank=True)
    video_content = models.TextField(null=True, blank=True)
    video_link = models.TextField(null=True, blank=True)
    canvas_content = models.TextField(null=True, blank=True)
    file_name = models.TextField(null=True, blank=True)
    file = models.FileField(upload_to=user_layer_upload_to, null=True)
    preview = models.FileField(upload_to=user_layer_upload_to, null=True)
    file_text_content = models.TextField(null=True, blank=True)
   
    # Aditionnal fields
    notification = models.TextField(null=True, blank=True)
    archive = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now=True)
    modified_at = models.DateTimeField(default=timezone.now)
    uploaded_at = utc_now

    def __str__(self):
        return f"Node {self.node_id} - Type: {self.type}"
    
    def save(self, *args, **kwargs):
        if not self.pk:  # If the object is being created
            self.uploaded_at = timezone.now()  # Set uploaded_at to the current time
            self.modified_at = timezone.now()
        else:
            self.modified_at = timezone.now()
        super().save(*args, **kwargs)

    class Meta:
        ordering = ['user', 'node_id']
        unique_together = ('user', 'node_id') 
    

class Link(models.Model):
    user = models.ForeignKey('NodzUser', on_delete=models.CASCADE)
    link_id = models.PositiveIntegerField(default=1)
    linkA = models.TextField(default='')
    linkB = models.TextField(default='')
    layer = models.ForeignKey(Layer, on_delete=models.CASCADE, related_name="links")

     # Aditionnal fields
    archive = models.BooleanField(default=False)

    class Meta:
        ordering = ['user', 'link_id']
        unique_together = ('user', 'link_id') 


class Template(models.Model):
    user = models.ForeignKey('NodzUser', on_delete=models.CASCADE)
    template_id = models.PositiveIntegerField(default=1)
    layer = models.ForeignKey(Layer, on_delete=models.CASCADE, related_name="templates")
    x_coordinate = models.FloatField(default=0)
    y_coordinate = models.FloatField(default=0)
    type = models.CharField(max_length=50,default='text')  
    size = models.FloatField(default=0)
    lock = models.BooleanField(default=False)

     # Aditionnal fields
    archive = models.BooleanField(default=False)

    class Meta:
        ordering = ['user', 'template_id']
        unique_together = ('user', 'template_id') 


class Feedback(models.Model):
    user = models.ForeignKey('NodzUser', on_delete=models.CASCADE, related_name="feedbacks")
    message = models.TextField()
    response = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_responded = models.BooleanField(default=False)

    def __str__(self):
        return f"Message from {self.user.username if self.user else 'Anonymous'}"
    


import uuid

class Invite(models.Model):
    nodes = models.ManyToManyField(Node)
    links = models.ManyToManyField(Link)
    params = models.ManyToManyField(Param)
    token = models.CharField(max_length=36, unique=True, default=uuid.uuid4)
    invited_by = models.ForeignKey(NodzUser, on_delete=models.CASCADE)
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)
    access_count = models.IntegerField(default=0)
    max_access = models.IntegerField(default=5)

    def is_expired(self):
        return self.expires_at and timezone.now() > self.expires_at

    def increment_access(self):
        self.access_count += 1
        self.save()