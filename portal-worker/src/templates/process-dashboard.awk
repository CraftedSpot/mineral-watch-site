#!/usr/bin/awk -f
# Remove bulk upload sections and add placeholders

BEGIN {
    in_bulk_modal = 0
    in_bulk_css = 0
    in_bulk_js = 0
}

# Mark bulk upload modal section
/<!-- BULK UPLOAD MODAL - REDESIGNED -->/ {
    in_bulk_modal = 1
    print "<!-- BULK_UPLOAD_MODALS -->"
    next
}

# Mark bulk upload CSS section
/Bulk Upload Modal - Redesigned Styles/ {
    in_bulk_css = 1
    print "<!-- BULK_UPLOAD_STYLES -->"
    next
}

# Mark bulk upload JS section
/function escapeHtmlBulk/ {
    if (in_bulk_css) {
        in_bulk_css = 0
    }
    in_bulk_js = 1
    print "<!-- BULK_UPLOAD_SCRIPTS -->"
    next
}

# End of sections
/<style>/ {
    if (in_bulk_modal) {
        in_bulk_modal = 0
    }
}

/function escapeHtmlBulk/ {
    if (in_bulk_css) {
        in_bulk_css = 0
        in_bulk_js = 1
        print "<!-- BULK_UPLOAD_SCRIPTS -->"
        next
    }
}

/document\.addEventListener.*DOMContentLoaded/ {
    if (in_bulk_js) {
        in_bulk_js = 0
    }
}

# Print lines if not in removed sections
{
    if (!in_bulk_modal && !in_bulk_css && !in_bulk_js) {
        print
    }
}