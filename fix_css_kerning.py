import re

filepath = '/Users/tylermalin/Code/malamalabs.com/site.css'
with open(filepath, 'r') as f:
    content = f.read()

# For heading em tags, override the negative letter spacing
css_addition = """
/* Fix for Mālama kerning overlap */
em, .hero-h1-anim em, #what-is h2 em, .section-title em {
  letter-spacing: 0.01em !important;
}
.brand {
  letter-spacing: 0.01em !important;
}
"""

if "/* Fix for Mālama kerning overlap */" not in content:
    content += css_addition
    with open(filepath, 'w') as f:
        f.write(content)
