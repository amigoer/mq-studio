# dmgbuild settings for the MQ Studio disk image.
#
# dmgbuild writes the .DS_Store directly instead of scripting Finder, so the
# layout comes out the same on a CI runner as it does locally. create-dmg was
# rejected for this: its AppleScript path can hang indefinitely on a runner.
#
# Invoked from build/darwin/Taskfile.yml, which passes every path as a define:
#   dmgbuild -s settings.py -D app=... -D volicon=... -D background=... \
#            -D firstrun=... "MQ Studio" out.dmg
#
# Pass firstrun= (empty) for a signed build: the helper and the taller window
# it needs then drop out on their own.
#
# background points at the 1x PNG only. dmgbuild finds the @2x sibling beside
# it and runs `tiffutil -cathidpicheck` itself, which also asserts the 2x is
# exactly twice the 1x - a free guard against a stale render.
import os

app = defines['app']
app_name = os.path.basename(app)
first_run = defines.get('firstrun', '')
first_run_name = os.path.basename(first_run) if first_run else ''

format = 'UDZO'
filesystem = 'HFS+'

files = [app]
if first_run:
    files.append(first_run)

symlinks = {'Applications': '/Applications'}

icon = defines['volicon']
background = defines['background']

default_view = 'icon-view'
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
include_list_view_settings = False

icon_size = 128
text_size = 13
label_pos = 'bottom'
hide_extension = [app_name]

# Icon coordinates are top-left origin with y running down, and have to stay in
# step with the slots drawn into the matching background SVG.
if first_run:
    window_rect = ((200, 200), (600, 560))
    icon_locations = {
        app_name: (150, 155),
        'Applications': (450, 155),
        first_run_name: (300, 432),
    }
    hide_extension.append(first_run_name)
else:
    window_rect = ((200, 200), (600, 400))
    icon_locations = {
        app_name: (150, 200),
        'Applications': (450, 200),
    }


def _payload_bytes(path):
    total = 0
    for root, _, names in os.walk(path):
        for name in names:
            entry = os.path.join(root, name)
            if not os.path.islink(entry):
                total += os.path.getsize(entry)
    return total


# Sized from the actual payload rather than a fixed literal, so the image does
# not start failing to build the moment the bundle outgrows a hardcoded value.
size = '%dM' % max(64, int(_payload_bytes(app) / (1024 * 1024) * 1.4) + 24)
