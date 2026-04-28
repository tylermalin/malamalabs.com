import glob
import re

for filepath in glob.glob('/Users/tylermalin/Code/malamalabs.com/**/*.html', recursive=True):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # We want to replace the ZWNJ versions with a span-kerned version
    # We will use <span style="margin-left: 0.06em;">l</span>
    # Wait, the string "Mā&zwnj;lama" might be inside title tags or meta tags!
    # We cannot put HTML spans inside <title> or <meta> tags!
    pass
