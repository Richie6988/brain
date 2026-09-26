from django.contrib import admin
from .models import Feedback 

from django.contrib.admin import SimpleListFilter
from datetime import timedelta
from django.utils import timezone

class Last30DaysFilter(SimpleListFilter):
    title = 'Created in the last 30 days'
    parameter_name = 'last_30_days'

    def lookups(self, request, model_admin):
        return (
            ('yes', 'Feedback created in the last 30 days'),
            ('no', 'Feedback created before 30 days'),
        )

    def queryset(self, request, queryset):
        today = timezone.now()
        thirty_days_ago = today - timedelta(days=30)
        if self.value() == 'yes':
            return queryset.filter(created_at__gte=thirty_days_ago)
        if self.value() == 'no':
            return queryset.filter(created_at__lt=thirty_days_ago)
        return queryset
    

# Register the Feedback model with the admin panel
@admin.register(Feedback)  # This decorator registers Feedback to be managed via the admin interface
class FeedbackAdmin(admin.ModelAdmin):
    # Specify which fields to display in the admin list view
    list_display = ('id', 'user', 'message', 'created_at', 'is_responded', 'response')

    # Make the 'response' field editable directly in the list view
    list_editable = ('response',)
    
    # Add a filter sidebar for the admin to filter feedback by 'is_responded' status
    list_filter = ('is_responded', 'created_at', Last30DaysFilter)
    
    # Allow searching through the 'message' and 'response' fields in the admin panel
    search_fields = ('message', 'response')
    
    # Add custom actions (e.g., mark feedback as responded)
    actions = ['mark_as_responded','save_model']

    # Enable "Save as new" functionality
    save_as = True

    # Control whether the redirect goes to the newly created object (True) or the changelist view (False)
    save_as_continue = False  # Redirects to changelist view after saving as new

    # Add save buttons to the top of the form
    save_on_top = True

        # Override save_model to ensure 'response' is saved
    def save_model(self, request, obj):
        for feedback in obj:
            if feedback.response:  # Only mark as responded if there's a response
                feedback.is_responded = True
                feedback.save() 

    # Action to mark feedback as responded (after response is saved)
    def mark_as_responded(self, request, queryset):
        updated_count = 0
        for feedback in queryset:
            if feedback.response:  # Only mark as responded if there's a response
                feedback.is_responded = True
                feedback.save()  # Save the feedback to mark it as responded
                updated_count += 1
            else:
                self.message_user(request, f"Feedback ID {feedback.id} does not have a response. Cannot mark as responded.", level="error")

        self.message_user(request, f'{updated_count} feedback(s) marked as responded.')

    mark_as_responded.short_description = "Mark selected feedback as responded"