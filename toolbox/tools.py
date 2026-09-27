"""Catalogue des outils du Gardien : ceux de Nodz et ceux portés d'iAqua (Poseidon), en une liste.

Chaque outil a sa ligne de consigne pour le modèle (`doc`) : le prompt du Gardien est construit à partir
des outils activés pour son agent (Agent.tools_allowed ; vide = tous). Les outils d'iAqua qui n'ont pas
de sens ou pas de place sur un serveur partagé sont listés à part, avec la raison.
"""

NODZ, IAQUA, BOTH = 'nodz', 'iaqua', 'nodz+iaqua'

TOOLS = [
    # --- Nodes
    {'op': 'create', 'category': 'Nodes', 'source': NODZ, 'label': 'Créer un node',
     'doc': '{"op":"create","ref":"new1","text":"...","near":"N-3","color":"#4D96FF","shape":"circle"} : nouveau node '
            'placé près de `near` ; couleur et forme facultatives.'},
    {'op': 'update', 'category': 'Nodes', 'source': NODZ, 'label': 'Réécrire un node',
     'doc': '{"op":"update","ref":"N-2","text":"..."} : remplace le texte d\'un node.'},
    {'op': 'style', 'category': 'Nodes', 'source': NODZ, 'label': 'Apparence (couleur, forme, taille, verrou)',
     'doc': '{"op":"style","ref":"N-2","color":"#FF6B6B","shape":"square","radius":90,"lock":true} : apparence '
            '(formes : circle, square, none ; taille 20 à 400 ; lock empêche de le déplacer).'},
    {'op': 'set_type', 'category': 'Nodes', 'source': NODZ, 'label': 'Type de node (texte, image, fichier, dessin)',
     'doc': '{"op":"set_type","ref":"N-2","content_type":"canvas"} : type du node (text, image, file, canvas = dessin).'},
    {'op': 'archive', 'category': 'Nodes', 'source': NODZ, 'label': 'Supprimer un node',
     'doc': '{"op":"archive","ref":"N-4"} : supprime un node (annulable avec Ctrl+Z).'},
    {'op': 'cleanup', 'category': 'Nodes', 'source': NODZ, 'label': 'Ménage des nodes vides',
     'doc': '{"op":"cleanup"} : supprime les nodes vides du plan.'},
    {'op': 'mindmap', 'category': 'Nodes', 'source': BOTH, 'iaqua': 'plan_project', 'label': 'Carte mentale',
     'doc': '{"op":"mindmap","ref":"new1","text":"Sujet","children":["idée 1","idée 2"],"near":"N-3"} : carte mentale, '
            'un node central (nouveau ou existant) entouré de ses idées, toutes reliées à lui.'},
    # --- Liens et dimensions
    {'op': 'link', 'category': 'Liens et dimensions', 'source': NODZ, 'label': 'Relier deux nodes',
     'doc': '{"op":"link","source":"N-1","target":"new1"} : crée un lien.'},
    {'op': 'unlink', 'category': 'Liens et dimensions', 'source': NODZ, 'label': 'Détacher deux nodes',
     'doc': '{"op":"unlink","source":"N-1","target":"N-2"} : retire un lien.'},
    {'op': 'portal', 'category': 'Liens et dimensions', 'source': NODZ, 'label': 'Portail vers une nouvelle dimension',
     'doc': '{"op":"portal","ref":"N-2","name":"Recherche"} : téléporte N-2 dans une nouvelle dimension `name`, reliée par un portail.'},
    # --- Navigation (caméra)
    {'op': 'focus', 'category': 'Navigation', 'source': NODZ, 'label': 'Travelling vers un node',
     'doc': '{"op":"focus","ref":"N-2","zoom":1.5,"text":"légende"} : travelling vers un node puis légende. '
            'Enchaîne plusieurs focus pour une visite guidée ou un tutoriel.'},
    {'op': 'overview', 'category': 'Navigation', 'source': NODZ, 'label': 'Vue d\'ensemble',
     'doc': '{"op":"overview","text":"..."} : prend du recul pour montrer tout le plan.'},
    {'op': 'travel', 'category': 'Navigation', 'source': NODZ, 'label': 'Voyager vers une dimension',
     'doc': '{"op":"travel","name":"<dimension>","text":"..."} : voyage vers une autre dimension.'},
    {'op': 'goto', 'category': 'Navigation', 'source': NODZ, 'label': 'Aller à un node trouvé',
     'doc': '{"op":"goto","ref":"N-45","text":"légende"} : voyage jusqu\'à un node trouvé par search_nodes, même dans une autre dimension.'},
    # --- Agents
    {'op': 'delegate', 'category': 'Agents', 'source': BOTH, 'iaqua': 'dispatch_to_agent, generate_image', 'label': 'Confier à un agent',
     'doc': '{"op":"delegate","agent":"<nom>","task":"consigne précise","ref":"new1 ou N-2","near":"N-1"} : confie la '
            'production à un agent ; son résultat est publié dans le node `ref` (créé s\'il est nouveau). Pour un agent '
            'd\'image (Illustrateur), `task` est un prompt d\'image en anglais, précis (sujet, style, lumière, cadrage) : '
            'l\'image est posée dans le node `ref`.'},
    {'op': 'plug_agent', 'category': 'Agents', 'source': BOTH, 'iaqua': 'update_agent_field', 'label': 'Brancher un modèle sur un agent',
     'doc': '{"op":"plug_agent","agent":"<nom>","model":"<partie du nom du modèle>"} : branche un modèle sur un agent.'},
    {'op': 'create_agent', 'category': 'Agents', 'source': IAQUA, 'iaqua': 'create_agent', 'label': 'Créer un agent',
     'doc': '{"op":"create_agent","name":"Traducteur","role":"text","description":"...","prompt":"consignes","model":"qwen"} : '
            'crée un agent spécialisé (rôles : text, code, tools).'},
    {'op': 'update_agent', 'category': 'Agents', 'source': IAQUA, 'iaqua': 'update_agent_field', 'label': 'Régler un agent',
     'doc': '{"op":"update_agent","agent":"<nom>","description":"...","prompt":"...","enabled":false} : modifie ses '
            'consignes ou l\'active / le désactive.'},
    # --- Mémoire
    {'op': 'remember', 'category': 'Mémoire', 'source': IAQUA, 'iaqua': 'update_user_context, update_brain_field', 'label': 'Retenir',
     'doc': '{"op":"remember","text":"fait durable sur l\'utilisateur ou ses projets"} : tu le retrouveras à chaque demande.'},
    {'op': 'forget', 'category': 'Mémoire', 'source': IAQUA, 'iaqua': 'update_brain_field', 'label': 'Oublier',
     'doc': '{"op":"forget","text":"..."} : oublie les souvenirs qui contiennent ce texte.'},
    # --- Lectures : le résultat revient au tour suivant
    {'op': 'inventory', 'category': 'Lecture', 'source': BOTH, 'iaqua': 'list_agents, list_models, list_projects', 'read': True,
     'label': 'Inventaire (dimensions, agents, modèles)', 'doc': '{"op":"inventory"} : dimensions, agents et modèles.'},
    {'op': 'search_nodes', 'category': 'Lecture', 'source': BOTH, 'iaqua': 'list_files, read_project_memory', 'read': True,
     'label': 'Chercher dans tous les nodes', 'doc': '{"op":"search_nodes","query":"mots"} : cherche dans tous les nodes de l\'utilisateur, toutes dimensions.'},
    {'op': 'read_file', 'category': 'Lecture', 'source': BOTH, 'iaqua': 'read_file', 'read': True, 'label': 'Lire un document',
     'doc': '{"op":"read_file","ref":"N-7"} : lit le texte du document d\'un node fichier.'},
    {'op': 'web_search', 'category': 'Web', 'source': IAQUA, 'iaqua': 'web_search', 'read': True, 'label': 'Recherche web',
     'doc': '{"op":"web_search","query":"..."} : recherche sur le web ; cite tes sources (adresse) dans les nodes que tu crées.'},
    {'op': 'web_fetch', 'category': 'Web', 'source': IAQUA, 'iaqua': 'web_fetch', 'read': True, 'label': 'Lire une page web',
     'doc': '{"op":"web_fetch","url":"https://..."} : lit une page publique.'},
]
BY_OP = {t['op']: t for t in TOOLS}

# Outils d'iAqua non portés : la raison est affichée dans la fenêtre Outils.
NOT_PORTED = [
    ('execute_bash', 'Commandes sur le serveur : trop dangereux sur un serveur partagé avec des invités.'),
    ('git', 'Dépôts de code du serveur : hors du périmètre de Nodz.'),
    ('write_file, edit_file', 'Écriture de fichiers sur le serveur : les contenus vivent dans les nodes.'),
    ('send_email', 'Envoi de courriels au nom du serveur : risque d\'abus.'),
    ('list_mcp_servers, call_mcp_tool', 'Serveurs MCP : à brancher plus tard, avec une liste blanche par administrateur.'),
    ('forge_tool, pyenv', 'Création d\'outils et environnements Python à la volée : exécution de code arbitraire.'),
    ('schedule_task, create_task, list_tasks, update_task, delete_task', 'Tâches planifiées : prévu (rappels dans les nodes).'),
    ('create_project, launch_mission, mission_status, audit_project, update_project, update_project_memory',
     'Projets et missions d\'iAqua : dans Nodz, un projet est une dimension (portal, travel, mindmap).'),
    ('generate_pptx, generate_docx', 'Export de documents : prévu (export d\'une dimension).'),
    ('edit_image', 'Retouche d\'image : prévu avec stable-diffusion.cpp (img2img).'),
    ('delete_agent', 'Suppression d\'agent : décision irréversible, laissée à l\'utilisateur.'),
    ('write_skill, list_skills, delete_skill, record_skill_outcome', 'Compétences d\'iAqua : remplacées par les consignes modifiables des agents.'),
    ('get_logs, read_my_brain', 'Journaux et état interne : visibles dans la tour de contrôle et la fenêtre Agents.'),
]


def enabled(agent):
    """Opérations permises au Gardien (tools_allowed vide = toutes)."""
    allowed = [op for op in agent.tools_allowed or [] if op in BY_OP]
    return allowed or [t['op'] for t in TOOLS]


def prompt(ops):
    """Lignes d'outils du prompt : actions, puis lectures."""
    actions = [f"- {t['doc']}" for t in TOOLS if t['op'] in ops and not t.get('read')]
    reads = [f"- {t['doc']}" for t in TOOLS if t['op'] in ops and t.get('read')]
    lines = ['Actions possibles :', *actions]
    if reads:
        lines += ['Lectures (tu reçois le résultat et continues au tour suivant) :', *reads]
    return '\n'.join(lines)
