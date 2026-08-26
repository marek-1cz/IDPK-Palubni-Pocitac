from flask import Flask, send_file
import pyautogui

app = Flask(__name__)

# Vypne otravné logování každého kliknutí do konzole
import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

@app.route('/')
def domu():
    # Pošle do mobilu tvůj design
    return send_file('web_ovladac.html')

@app.route('/press/<action>')
def stiskni(action):
    # Překlad tlačítek z mobilu na klávesy pro tvůj Electron
    klavesy = {
        'up': 'up',
        'down': 'down',
        'del': 'backspace',
        'ent': 'enter',
        'dot': '*',
        'space': 'space',
        'r': 'r',
        's': 's',
        'esc': 'esc'
    }
    
    if action in '0123456789':
        pyautogui.press(action)
    elif action in klavesy:
        pyautogui.press(klavesy[action])
        
    return "OK"

if __name__ == '__main__':
    print("=========================================")
    print(" IDPK-OIS SERVER BĚŽÍ (MODUL OVLADAČE) ")
    print(" Připoj se z mobilu na IP adresu notebooku")
    print(" port: 5000 (např. http://192.168.x.x:5000)")
    print("=========================================")
    app.run(host='0.0.0.0', port=5000)