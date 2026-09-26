from django.contrib.auth.forms import UserCreationForm
from nodzapp.models import NodzUser

# class RegisterForm(UserCreationForm):
#     class Meta:
#         model = NodzUser
#         fields = ["username","password1","password2"]



from django import forms

class ContactForm(forms.Form):
    name = forms.CharField(max_length=100, required=True, widget=forms.TextInput(attrs={
        'placeholder': 'Your name',
        'class': 'form-control'
    }))
    email = forms.EmailField(required=True, widget=forms.EmailInput(attrs={
        'placeholder': 'Your email',
        'class': 'form-control'
    }))
    message = forms.CharField(widget=forms.Textarea(attrs={
        'placeholder': 'Your message',
        'class': 'form-control',
        'rows': 3
    }), required=True)
