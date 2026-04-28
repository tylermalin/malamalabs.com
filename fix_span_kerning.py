import glob
import re

for filepath in glob.glob('/Users/tylermalin/Code/malamalabs.com/**/*.html', recursive=True):
    with open(filepath, 'r') as f:
        content = f.read()
    
    if '</head>' in content:
        head, body = content.split('</head>', 1)
        
        # Replace Mā&zwnj;lama and Mālama in body
        # We will use <span style="margin-left: 0.05em;">l</span>
        body = re.sub(r'Mā(?:&zwnj;)?lama', 'Mā<span style="margin-left: 0.05em;">l</span>ama', body)
        body = re.sub(r'mā(?:&zwnj;)?lama', 'mā<span style="margin-left: 0.05em;">l</span>ama', body)
        
        # Reconstruct content
        new_content = head + '</head>' + body
        
        # Clean up <title> and <meta> in head just in case they have ZWNJ
        new_head = head.replace('Mā&zwnj;lama', 'Mālama').replace('mā&zwnj;lama', 'mālama')
        new_content = new_head + '</head>' + body
        
        with open(filepath, 'w') as f:
            f.write(new_content)
