#!/usr/bin/python3

import os, argparse
from jinja2 import Environment, FileSystemLoader


# Script options and arguments
parser = argparse.ArgumentParser(description='Create Sonador configuration for PWA build')
parser.add_argument('dest', nargs=1, help='PWA configuration output destination')

args = parser.parse_args()


if __name__ == '__main__':
    
    # Create Jinja template environment and loader
    env = Environment(loader=FileSystemLoader('/usr/src/app/.sonador/dist_sonador/'))
    template = env.get_template('pwa_config.template')

    # Render configuration and output to destination
    with open(args.dest[0], "w") as fh:
        fh.write(template.render(ohif_host=os.environ.get('OHIF_HOST')))
    