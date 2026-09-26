from django.urls import path
from . import views
from django.contrib.auth.views import LogoutView
from django.contrib import admin

urlpatterns = [
    path('',views.home,name='home'),
    path('contact', views.contact, name='contact'),
    path('submit-feedback/', views.submit_feedback, name='submit-feedback'),
    path('feedback', views.feedback, name='feedback'),
    path('privacy',views.privacy,name='privacy'),
    path('terms',views.terms,name='terms'),
    path('universe',views.universe,name='universe'),
    path('universe/r-<int:r_id>/',views.referree,name='referree'),
    path('referrer/',views.referrer,name='referrer'),
    path('test',views.test,name='test'),
    path('checklogin/', views.checklogin, name='checklogin'),
    path('login/', views.LoginView.as_view(), name='login'),
    path('guest/', views.guest, name='guest'),
    path('register/',views.register, name='register'),
    path('forgot-password/', views.forgot_password, name='forgot_password'),
    path('new-password/', views.new_password, name='new_password'),
    path('logout/', LogoutView.as_view(), name='logout'),    
    path('save-layers/', views.save_layers, name='save_layers'),
    path('delete-layer/', views.delete_layer, name='delete_layer'),
    path('delete-account/', views.delete_account, name='delete_account'),
    path('save-node/', views.save_node, name='save_node'),
    path('save-template/', views.save_template, name='save_template'),
    path('save-quantum/', views.save_quantum, name='save_quantum'),
    path('delete-quantum/', views.delete_quantum, name='delete_quantum'),
    path('loading/', views.loading, name='loading'),
    path('admin-loading/', views.admin_loading, name='admin_loading'),
    # path('multi-loading/', views.multi_loading, name='multi_loading'),
    path('delete/', views.delete, name='delete'),
    path('semantic-search/', views.semantic_search, name='semantic_search'),
    path('upload-file/', views.upload_file, name='upload_file'),
    path('load-file/', views.load_file, name='load_file'),
    path('download-file/', views.download_file, name='download_file'),
    path('YTsearch/', views.YTsearch, name='YTsearch'),
    path('process-payment/', views.process_payment, name='process_payment'),
    path('cancel-subscription/', views.cancel_subscription, name='cancel_subscription'),
    path('generate_invite/<str:node_ids>/', views.generate_invite, name='generate_invite'),
    path('invite_access/<str:token>/', views.invite_access, name='invite_access'),
    path('api/shared_nodes/', views.shared_nodes, name='shared_nodes'),  # API endpoint for nodes
    path('generate-download-link/<str:node_id>/<str:filename>/', views.generate_download_link, name='generate_download_link'),
    path('get-file/<str:token>/<path:filename>/', views.get_file, name='get_file'),
    path('send-validation-code/', views.send_validation_code, name='send_validation_code'),
    path('verify-validation-code/', views.verify_validation_code, name='verify_validation_code'),
    path('get-profile/', views.get_profile, name='get_profile'),
    path('save-profile/', views.save_profile, name='save_profile'),
    path('admin-users/', views.admin_users, name='admin_users'),
]


