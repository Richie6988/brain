"""Catalogue des outils du Gardien : ceux de Nodz et tous ceux d'iAqua (Poseidon), en une liste.

Chaque outil a son mode d'emploi (`doc`) et une adresse, outils/<dossier>/<outil> (le dossier est sa famille). Le
prompt du Gardien est un répertoire stable (une ligne par dossier) ; les modes d'emploi des dossiers que la
demande appelle lui arrivent avec elle (aiguillage par mots-clés, relevant), et il ouvre une autre adresse (op open)
au besoin. Un mode d'emploi réécrit dans le node de l'outil (dimension Gardien de l'univers) prime sur celui du
catalogue.
Outils administrateur (admin) : ils exécutent du code sur le serveur, donc compte admin et GUARDIAN_SHELL=1.
"""

import json
import re
import unicodedata

NODZ, IAQUA, BOTH = 'nodz', 'iaqua', 'nodz+iaqua'

TOOLS = [
    # --- Dialogue : le Gardien parle avec son humain
    {'op': 'ask', 'category': 'Dialogue', 'source': NODZ, 'label': 'Poser une question à l\'humain',
     'doc': '{"op":"ask","text":"Un arbre ou une matrice ?","choices":["Arbre","Matrice"]} : si la demande est ambiguë, UNE '
            'question courte avec 2 à 4 choix ; l\'humain répond d\'un clic et sa réponse arrive comme un nouveau message. '
            'N\'ajoute pas d\'autre action avec elle.'},
    {'op': 'note', 'category': 'Dialogue', 'source': NODZ, 'label': 'Laisser une note (correspondance)',
     'doc': '{"op":"note","text":"J\'ai remarqué que…","choices":["Oui","Plus tard"]} : une note pour plus tard, posée dans la '
            'dimension Échanges ; l\'humain y répond dans un node relié, et tu lis sa réponse aux demandes suivantes.'},
    # --- Nodes
    {'op': 'put', 'category': 'Nodes', 'source': NODZ, 'label': 'Écrire un node (objet complet)',
     'doc': '{"op":"put","ref":"new1","near":"N-3","text":"...","color":"#4D96FF","shape":"square","links":["N-3"],"children":["a","b"]} : '
            'le node tel que tu le lis : nouveau (new1) ou existant (N-12) ; texte, apparence, liens et enfants en une action, '
            'seuls les champs donnés changent.'},
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
    {'op': 'tour', 'category': 'Navigation', 'source': NODZ, 'label': 'Visite interactive d\'une branche',
     'doc': '{"op":"tour","ref":"N-3"} : lance la visite interactive depuis N-3 : la caméra suit les liens, l\'utilisateur choisit '
            'la branche à chaque embranchement, règle la vitesse, met en pause. Pour « fais-moi visiter… ».'},
    {'op': 'goto', 'category': 'Navigation', 'source': NODZ, 'label': 'Aller à un node trouvé',
     'doc': '{"op":"goto","ref":"N-45","text":"légende"} : voyage jusqu\'à un node trouvé par search_nodes, même dans une autre dimension.'},
    # --- Gabarits : des structures de nodes que le Gardien construit, et qu'il peut garder pour les réutiliser
    {'op': 'build', 'category': 'Gabarits', 'source': NODZ, 'label': 'Construire un gabarit (matrice, kanban, frise…)',
     'doc': '{"op":"build","layout":"matrix","title":"Eisenhower","rows":["Urgent","Pas urgent"],"cols":["Important","Secondaire"],'
            '"cells":[["Faire","Déléguer"],["Planifier","Abandonner"]],"near":"N-3","color":"#6848A6","save_as":"eisenhower"} : '
            'construit une structure de nodes dans un coin libre. layout : matrix (rows, cols, cells[ligne][colonne]), kanban '
            '(cols, cells[colonne] = cartes), timeline (items dans l\'ordre), pyramid (items du sommet à la base), tree (items : '
            'une ligne par node, 2 espaces d\'indentation par niveau), list (items). {"op":"build","template":"eisenhower",'
            '"cells":[...]} réutilise un gabarit gardé ; save_as le garde.'},
    {'op': 'grow', 'category': 'Gabarits', 'source': NODZ, 'label': 'Faire pousser un raisonnement (structure organique)',
     'doc': '{"op":"grow","near":"N-3","text":"Idée centrale\\n- Branche : détail\\n  - sous-idée\\n- Autre branche"} : pour un '
            'raisonnement long ou une explication : écris un plan libre, une idée par ligne, indentée (2 espaces, puces ou #) ; '
            'il pousse en étoile, une couleur par branche, 80 idées au plus. Avec "ref":"N-12", il pousse autour de ce node.'},
    {'op': 'template_save', 'category': 'Gabarits', 'source': NODZ, 'label': 'Garder un gabarit',
     'doc': '{"op":"template_save","name":"retro","layout":"kanban","title":"Rétrospective","cols":["Bien","À améliorer","Actions"],'
            '"description":"rétro d\'équipe"} : garde un gabarit pour le reconstruire plus tard (build avec template).'},
    {'op': 'templates', 'category': 'Gabarits', 'source': NODZ, 'read': True, 'label': 'Gabarits gardés',
     'doc': '{"op":"templates"} : liste les gabarits gardés (nom, forme, description).'},
    {'op': 'template_delete', 'category': 'Gabarits', 'source': NODZ, 'label': 'Oublier un gabarit',
     'doc': '{"op":"template_delete","name":"retro"} : oublie un gabarit gardé.'},
    {'op': 'schema', 'category': 'Gabarits', 'source': NODZ, 'label': 'Modèle connu de la galerie (SWOT, Ishikawa…)',
     'doc': '{"op":"schema","type":"swot","near":"N-3","title":"Mon projet","fill":{"Forces":["idée","idée"],"Menaces":"Concurrence"}} : '
            'pose un modèle de la galerie, fait de nodes et de liens, déjà rempli. title : le node central. fill : intitulé d\'une '
            'case → un texte (la case change de texte) ou une liste d\'idées (posées autour d\'elle, à la place des exemples). '
            'Types et intitulés : swot (Forces, Faiblesses, Opportunités, Menaces), eisenhower (Faire, Planifier, Déléguer, '
            'Abandonner), bcg (Vedettes, Dilemmes, Vaches à lait, Poids morts), pestel (Politique, Économique, Social, '
            'Technologique, Écologique, Légal), porter (Nouveaux entrants, Pouvoir des fournisseurs, Produits de substitution, '
            'Pouvoir des clients), smart (Spécifique, Mesurable, Atteignable, Réaliste, Temporel), organic (Pourquoi, Qui, Comment, '
            'Quand, Risques), org (Pôle 1, Pôle 2, Pôle 3), decision (Option A, Option B), family (Père, Mère), '
            'bmc (Partenaires clés, Activités clés, Ressources clés, Proposition de valeur, Relations clients, Canaux, Segments de '
            'clientèle, Structure de coûts, Sources de revenus), ikigai (Ce que tu aimes, Ce en quoi tu es doué, Ce dont le monde '
            'a besoin, Ce pour quoi tu peux être payé, Passion, Mission, Profession, Vocation), ansoff (Pénétration, '
            'Développement de produits, Développement de marchés, Diversification), tows (SO : attaquer, WO : renforcer, '
            'ST : défendre, WT : éviter), m3x3 (Ligne 1…3, Colonne 1…3), ishikawa (Main-d\'œuvre, Méthodes, Matériel, Matière, '
            'Milieu, Mesure), kanban (À faire, En cours, Fait), timeline (2024, 2025, 2026, 2027), pdca (Planifier, Faire, '
            'Vérifier, Agir), process (Étape 1, Étape 2, Étape 3), design (Empathie, Définir, Idéer, Prototyper, Tester), '
            'aida (Attention, Intérêt, Désir, Action), maslow (Physiologiques, Sécurité, Appartenance, Estime, Accomplissement), '
            'why (Problème, Cause racine).'},
    # --- Agents
    {'op': 'delegate', 'category': 'Agents', 'source': BOTH, 'iaqua': 'dispatch_to_agent, generate_image', 'label': 'Confier à un agent',
     'doc': '{"op":"delegate","agent":"<nom>","task":"consigne précise","ref":"new1 ou N-2","near":"N-1"} : confie la '
            'production à un agent ; son résultat est publié dans le node `ref` (créé s\'il est nouveau). Pour un agent '
            'd\'image (Illustrateur), `task` est un prompt d\'image en anglais, précis (sujet, style, lumière, cadrage) : '
            'l\'image est posée dans le node `ref`. Sans modèle d\'image, l\'Illustrateur dessine lui-même : "mode":"vector" '
            '(dessin vectoriel net, par défaut) ou "mode":"sketch" (croquis tracé sur le canvas du node).'},
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
     'doc': '{"op":"read_file","ref":"N-7"} : texte du document d\'un node fichier ; {"op":"read_file","path":"notes/plan.md"} : '
            'fichier de l\'espace de travail.'},
    {'op': 'web_search', 'category': 'Web', 'source': IAQUA, 'iaqua': 'web_search', 'read': True, 'label': 'Recherche web',
     'doc': '{"op":"web_search","query":"..."} : recherche sur le web ; cite tes sources (adresse) dans les nodes que tu crées.'},
    {'op': 'web_fetch', 'category': 'Web', 'source': IAQUA, 'iaqua': 'web_fetch', 'read': True, 'label': 'Lire une page web',
     'doc': '{"op":"web_fetch","url":"https://..."} : lit une page publique.'},
    # --- Tâches (registre d'iAqua)
    {'op': 'create_task', 'category': 'Tâches', 'source': IAQUA, 'iaqua': 'create_task', 'label': 'Créer une tâche',
     'doc': '{"op":"create_task","title":"...","description":"...","acceptance_criteria":"2 à 4 critères vérifiables",'
            '"project":"NOM","agent":"<nom>","priority":"medium","run":true} : tâche au registre ; run confie aussitôt la tâche à son agent (en fond).'},
    {'op': 'list_tasks', 'category': 'Tâches', 'source': IAQUA, 'iaqua': 'list_tasks', 'read': True, 'label': 'Lister les tâches',
     'doc': '{"op":"list_tasks","status":"planned","project":"NOM"} : tâches (filtres facultatifs), avec leur résultat.'},
    {'op': 'update_task', 'category': 'Tâches', 'source': IAQUA, 'iaqua': 'update_task', 'label': 'Mettre à jour une tâche',
     'doc': '{"op":"update_task","task_id":"task_0001","field":"status","value":"completed"} : champs title, description, '
            'status (planned, in_progress, completed, failed), priority (low, medium, high, critical), agent, progress (note l\'étape), result.'},
    {'op': 'delete_task', 'category': 'Tâches', 'source': IAQUA, 'iaqua': 'delete_task', 'label': 'Supprimer une tâche',
     'doc': '{"op":"delete_task","task_id":"task_0001"} : retire la tâche du registre.'},
    {'op': 'schedule_task', 'category': 'Tâches', 'source': IAQUA, 'iaqua': 'schedule_task', 'label': 'Tâche récurrente',
     'doc': '{"op":"schedule_task","action":"create","expr":"daily@08:30","title":"...","agent":"<nom>"} : tâche qui revient '
            '(daily@HH:MM, weekly:mon@HH:MM, hourly, every:30m) ; action list, delete, enable, disable avec "schedule_id":"sched_0001".'},
    # --- Projets et missions
    {'op': 'create_project', 'category': 'Projets et missions', 'source': BOTH, 'iaqua': 'create_project', 'label': 'Créer un projet',
     'doc': '{"op":"create_project","name":"NOM","vision":"but en un paragraphe"} : projet avec sa mémoire, et une dimension du même nom.'},
    {'op': 'list_projects', 'category': 'Projets et missions', 'source': IAQUA, 'iaqua': 'list_projects', 'read': True, 'label': 'Lister les projets',
     'doc': '{"op":"list_projects"} : projets, statut et avancement des tâches.'},
    {'op': 'plan_project', 'category': 'Projets et missions', 'source': IAQUA, 'iaqua': 'plan_project', 'read': True, 'label': 'Contexte de planification',
     'doc': '{"op":"plan_project","goal":"but dans les mots de l\'utilisateur","project":"NOM"} : vision, mémoire, agents, tâches ouvertes et '
            'compétences, pour découper le but en tâches.'},
    {'op': 'update_project', 'category': 'Projets et missions', 'source': IAQUA, 'iaqua': 'update_project', 'label': 'Mettre à jour un projet',
     'doc': '{"op":"update_project","project_name":"NOM","field":"vision","new_value":"..."} : champs name, vision, status (active, archived), '
            'assign_agent, unassign_agent.'},
    {'op': 'update_project_memory', 'category': 'Projets et missions', 'source': IAQUA, 'iaqua': 'update_project_memory', 'label': 'Mémoire de projet',
     'doc': '{"op":"update_project_memory","project_name":"NOM","kind":"decision","content":"..."} : kind achievement, decision, blocker, '
            'resolve_blocker, next_steps, agent_sync.'},
    {'op': 'read_project_memory', 'category': 'Projets et missions', 'source': IAQUA, 'iaqua': 'read_project_memory', 'read': True,
     'label': 'Lire la mémoire d\'un projet', 'doc': '{"op":"read_project_memory","project_name":"NOM"} : vision, réussites, décisions, bloquants, suite.'},
    {'op': 'audit_project', 'category': 'Projets et missions', 'source': BOTH, 'iaqua': 'audit_project', 'read': True, 'label': 'Auditer un projet',
     'doc': '{"op":"audit_project","project_name":"NOM"} : avancement des tâches, nodes vides ou isolés de sa dimension, bloquants, suite.'},
    {'op': 'launch_mission', 'category': 'Projets et missions', 'source': IAQUA, 'iaqua': 'launch_mission', 'label': 'Mission autonome',
     'doc': '{"op":"launch_mission","goal":"but vérifiable","project":"NOM","budget":3} : planifie, confie aux agents, audite et recommence '
            'en fond, au plus `budget` tours.'},
    {'op': 'mission_status', 'category': 'Projets et missions', 'source': IAQUA, 'iaqua': 'mission_status', 'read': True, 'label': 'Suivi des missions',
     'doc': '{"op":"mission_status","mission_id":"mission_0001","abort":false} : sans identifiant, les missions récentes ; abort l\'arrête.'},
    # --- Compétences
    {'op': 'write_skill', 'category': 'Compétences', 'source': IAQUA, 'iaqua': 'write_skill', 'label': 'Écrire une compétence',
     'doc': '{"op":"write_skill","skill_id":"visite_guidee","name":"...","summary":"...","steps":["étape 1","étape 2"],"triggers":"quand…"} : '
            'recette réutilisable (nouvelle version si elle existe).'},
    {'op': 'list_skills', 'category': 'Compétences', 'source': IAQUA, 'iaqua': 'list_skills', 'read': True, 'label': 'Lister les compétences',
     'doc': '{"op":"list_skills"} : compétences, étapes et taux de réussite.'},
    {'op': 'delete_skill', 'category': 'Compétences', 'source': IAQUA, 'iaqua': 'delete_skill', 'label': 'Supprimer une compétence',
     'doc': '{"op":"delete_skill","skill_id":"..."} : retire une compétence fausse ou obsolète.'},
    {'op': 'record_skill_outcome', 'category': 'Compétences', 'source': IAQUA, 'iaqua': 'record_skill_outcome', 'label': 'Noter une compétence',
     'doc': '{"op":"record_skill_outcome","skill_id":"...","outcome":"success"} : success, partial ou fail, après usage.'},
    # --- Cerveau et journal
    {'op': 'read_my_brain', 'category': 'Mémoire', 'source': IAQUA, 'iaqua': 'read_my_brain', 'read': True, 'label': 'Lire mon cerveau',
     'doc': '{"op":"read_my_brain","section_path":"skills.visite_guidee"} : sections guidelines, memory, tools_catalog, skills, current_state, '
            'et tes champs libres.'},
    {'op': 'update_brain_field', 'category': 'Mémoire', 'source': IAQUA, 'iaqua': 'update_brain_field', 'label': 'Modifier mon cerveau',
     'doc': '{"op":"update_brain_field","field_path":"style.ton","value":"..."} : guidelines remplace tes consignes, memory ajoute un souvenir, '
            'tout autre chemin est un champ libre (JSON accepté).'},
    {'op': 'update_user_context', 'category': 'Mémoire', 'source': IAQUA, 'iaqua': 'update_user_context', 'label': 'Contexte utilisateur',
     'doc': '{"op":"update_user_context","text":"..."} : comme remember.'},
    {'op': 'get_logs', 'category': 'Mémoire', 'source': IAQUA, 'iaqua': 'get_logs', 'read': True, 'label': 'Journal',
     'doc': '{"op":"get_logs","limit":20,"event_type":"task_created"} : tes dernières actions enregistrées.'},
    # --- Fichiers et git (espace de travail de l'utilisateur)
    {'op': 'write_file', 'category': 'Fichiers et git', 'source': IAQUA, 'iaqua': 'write_file', 'label': 'Écrire un fichier',
     'doc': '{"op":"write_file","path":"notes/plan.md","content":"..."} : fichier de l\'espace de travail (dossiers créés au besoin).'},
    {'op': 'list_files', 'category': 'Fichiers et git', 'source': IAQUA, 'iaqua': 'list_files', 'read': True, 'label': 'Lister des fichiers',
     'doc': '{"op":"list_files","path":"."} : contenu d\'un dossier de l\'espace de travail.'},
    {'op': 'edit_file', 'category': 'Fichiers et git', 'source': IAQUA, 'iaqua': 'edit_file', 'label': 'Modifier un fichier',
     'doc': '{"op":"edit_file","path":"...","search_text":"texte présent une seule fois","replace_text":"..."} : remplacement ciblé.'},
    {'op': 'git', 'category': 'Fichiers et git', 'source': IAQUA, 'iaqua': 'git', 'read': True, 'label': 'Git',
     'doc': '{"op":"git","action":"status"} : status, diff (path facultatif), log, commit (message, files facultatif) dans l\'espace de travail.'},
    # --- Documents et e-mail
    {'op': 'generate_docx', 'category': 'Documents et e-mail', 'source': IAQUA, 'iaqua': 'generate_docx', 'read': True, 'label': 'Document Word',
     'doc': '{"op":"generate_docx","filename":"rapport","title":"...","markdown":"# Titre\\n- point","template":"<modèle docx>"} : .docx '
            'téléchargeable ; template : un modèle de documents de l\'utilisateur (son style), facultatif.'},
    {'op': 'generate_xlsx', 'category': 'Documents et e-mail', 'source': NODZ, 'label': 'Classeur Excel', 'read': True,
     'doc': '{"op":"generate_xlsx","filename":"budget","title":"...","rows":[["Poste","Montant"],["Loyer",900]],"template":"<modèle xlsx>"} : '
            '.xlsx téléchargeable ; avec un modèle, les lignes s\'ajoutent sous ses en-têtes.'},
    {'op': 'generate_pdf', 'category': 'Documents et e-mail', 'source': NODZ, 'label': 'PDF', 'read': True,
     'doc': '{"op":"generate_pdf","filename":"devis","title":"...","markdown":"# Titre\\n- point","template":"<modèle pdf>"} : .pdf '
            'téléchargeable ; avec un modèle, chaque page est posée sur sa première page (papier à en-tête).'},
    {'op': 'generate_pptx', 'category': 'Documents et e-mail', 'source': IAQUA, 'iaqua': 'generate_pptx', 'read': True, 'label': 'Présentation',
     'doc': '{"op":"generate_pptx","filename":"pitch","title":"...","slides":[{"title":"...","bullets":["..."]}],"template":"<modèle pptx>"} : '
            '.pptx téléchargeable ; avec un modèle, son thème, ses polices et ses mises en page.'},
    {'op': 'send_email', 'category': 'Documents et e-mail', 'source': IAQUA, 'iaqua': 'send_email', 'label': 'Envoyer un e-mail',
     'doc': '{"op":"send_email","subject":"...","body":"..."} : à l\'adresse de l\'utilisateur (un administrateur peut préciser "to").'},
    # --- Images
    {'op': 'generate_image', 'category': 'Images', 'source': IAQUA, 'iaqua': 'generate_image', 'label': 'Générer une image',
     'doc': '{"op":"generate_image","prompt":"prompt en anglais","ref":"new1","near":"N-1","mode":"vector|sketch"} : l\'agent '
            'd\'image dessine dans un node (FLUX / SD s\'il est installé, sinon dessin vectoriel ou croquis).'},
    {'op': 'edit_image', 'category': 'Images', 'source': IAQUA, 'iaqua': 'edit_image', 'label': 'Retoucher une image',
     'doc': '{"op":"edit_image","ref":"N-5","prompt":"ce qui change","strength":0.6} : img2img sur un node image ; strength de 0 (proche) à 1 (libre).'},
    # --- Agents (compléments d'iAqua)
    {'op': 'list_agents', 'category': 'Agents', 'source': IAQUA, 'iaqua': 'list_agents', 'read': True, 'label': 'Lister les agents',
     'doc': '{"op":"list_agents"} : agents, rôles, modèles et descriptions.'},
    {'op': 'list_models', 'category': 'Agents', 'source': IAQUA, 'iaqua': 'list_models', 'read': True, 'label': 'Lister les modèles',
     'doc': '{"op":"list_models"} : modèles de la bibliothèque et leur état.'},
    {'op': 'dispatch_to_agent', 'category': 'Agents', 'source': IAQUA, 'iaqua': 'dispatch_to_agent', 'label': 'Confier (iAqua)',
     'doc': '{"op":"dispatch_to_agent","agent":"<nom>","task":"...","ref":"new1"} : comme delegate.'},
    {'op': 'update_agent_field', 'category': 'Agents', 'source': IAQUA, 'iaqua': 'update_agent_field', 'label': 'Champ d\'agent',
     'doc': '{"op":"update_agent_field","agent":"<nom>","field_path":"prompt","new_value":"..."} : description, prompt, enabled, model.'},
    {'op': 'delete_agent', 'category': 'Agents', 'source': IAQUA, 'iaqua': 'delete_agent', 'label': 'Supprimer un agent', 'default': False,
     'doc': '{"op":"delete_agent","agent":"<nom>"} : irréversible ; seulement si l\'utilisateur le demande en nommant l\'agent.'},
    # --- Administrateur : exécutent du code sur le serveur (compte admin et GUARDIAN_SHELL=1)
    {'op': 'execute_bash', 'category': 'Administrateur', 'source': IAQUA, 'iaqua': 'execute_bash', 'read': True, 'admin': True,
     'label': 'Shell', 'doc': '{"op":"execute_bash","command":"ls -la","cwd":".","timeout":30} : commande dans l\'espace de travail.'},
    {'op': 'pyenv', 'category': 'Administrateur', 'source': IAQUA, 'iaqua': 'pyenv', 'read': True, 'admin': True, 'label': 'Environnement Python',
     'doc': '{"op":"pyenv","action":"install","packages":["pandas"]} : install, list, remove dans l\'environnement Python dédié.'},
    {'op': 'forge_tool', 'category': 'Administrateur', 'source': IAQUA, 'iaqua': 'forge_tool', 'read': True, 'admin': True, 'label': 'Forger un outil',
     'doc': '{"op":"forge_tool","action":"create","name":"convertisseur","description":"...","code":"import json,sys\\n'
            'data=json.load(sys.stdin)\\nprint(json.dumps(...))","test_input":"{}"} : script Python testé puis enregistré ; list, delete, enable, disable.'},
    {'op': 'run_tool', 'category': 'Administrateur', 'source': IAQUA, 'iaqua': 'forge_tool', 'read': True, 'admin': True, 'label': 'Utiliser un outil forgé',
     'doc': '{"op":"run_tool","name":"convertisseur","input":{"...":"..."}} : exécute un outil forgé.'},
    {'op': 'list_mcp_servers', 'category': 'Administrateur', 'source': IAQUA, 'iaqua': 'list_mcp_servers', 'read': True, 'admin': True,
     'label': 'Serveurs MCP', 'doc': '{"op":"list_mcp_servers"} : serveurs MCP configurés (MCP_SERVERS).'},
    {'op': 'call_mcp_tool', 'category': 'Administrateur', 'source': IAQUA, 'iaqua': 'call_mcp_tool', 'read': True, 'admin': True,
     'label': 'Outil MCP', 'doc': '{"op":"call_mcp_tool","server":"nom","name":"tools/list","arguments":{}} : tools/list pour découvrir, puis le nom de l\'outil.'},
    # --- Aide
    {'op': 'open', 'category': 'Lecture', 'source': NODZ, 'read': True, 'label': 'Ouvrir une adresse du répertoire d\'outils',
     'doc': '{"op":"open","path":"outils/nodes/style"} : mode d\'emploi complet d\'un outil ; un dossier ("outils/web") liste ses '
            'outils avec leur exemple ; "outils" liste les dossiers. Plusieurs d\'un coup : "paths":[...].'},
    {'op': 'tool_help', 'category': 'Lecture', 'source': NODZ, 'read': True, 'label': 'Mode d\'emploi d\'outils',
     'doc': '{"op":"tool_help","names":["create_task","launch_mission"]} : mode d\'emploi détaillé des outils cités.'},
]
BY_OP = {t['op']: t for t in TOOLS}

RENAMED = {'backdrop': 'schema'}  # ancien nom d'un outil coché → son remplaçant (fonds dessinés → modèles en nodes)
# Outils courants : leur exemple JSON reste dans le prompt système (un petit modèle imite la forme qu'il voit) ;
# put, ask, build, grow, schema et open ont déjà le leur dans les exemples du prompt.
CORE = {'note', 'link', 'archive', 'style', 'focus', 'tour', 'delegate', 'remember', 'search_nodes'}
HIDDEN = {'tool_help'}  # ancien nom de open : toujours compris, jamais proposé
# Dossiers rares : le prompt n'en donne que le sujet ; le Gardien les ouvre (open) pour voir leurs outils
FOLDED = {'taches', 'projets', 'competences', 'fichiers', 'documents', 'images', 'administrateur'}


def available(op, user):
    """Les outils administrateur exécutent du code : compte admin et GUARDIAN_SHELL=1."""
    from django.conf import settings

    return not BY_OP[op].get('admin') or bool(user and user.is_staff and settings.GUARDIAN_SHELL)


def enabled(agent, user):
    """Opérations permises au Gardien : celles cochées (tools_allowed), sinon celles actives par défaut."""
    allowed = [op for op in dict.fromkeys(RENAMED.get(op, op) for op in agent.tools_allowed or []) if op in BY_OP]
    ops = allowed or [t['op'] for t in TOOLS if t.get('default', not t.get('admin'))]
    # tool_help, ask et note (parler à l'humain) et put (écrire un node comme il le lit) restent toujours permis, même avec
    # une liste d'outils cochés d'avant.
    return [op for op in ops if available(op, user)] + [op for op in ('open', 'tool_help', 'ask', 'put', 'note') if op not in ops]


def usage(op, docs=None):
    """Mode d'emploi d'un outil : celui écrit dans son node de l'univers s'il existe, sinon le catalogue."""
    return (docs or {}).get(op) or BY_OP[op]['doc']


def folder(category):
    """Dossier d'une famille d'outils : son premier mot, sans accent (Tâches → taches)."""
    return unicodedata.normalize('NFD', category.split()[0].lower()).encode('ascii', 'ignore').decode()


def address(op):
    return f"outils/{folder(BY_OP[op]['category'])}/{op}"


def example(op, docs=None):
    """L'exemple JSON d'un outil (le début de son mode d'emploi) ; un mode d'emploi réécrit dans l'univers, en entier."""
    text = usage(op, docs)
    if op in (docs or {}) or not text.startswith('{'):
        return text
    try:
        return text[:json.JSONDecoder().raw_decode(text)[1]]  # l'objet JSON entier, même s'il contient « : »
    except ValueError:
        return text


def folders(ops):
    """Dossiers du répertoire : nom → outils permis, dans l'ordre du catalogue."""
    out = {}
    for t in TOOLS:
        if t['op'] in ops and t['op'] not in HIDDEN:
            out.setdefault(folder(t['category']), []).append(t)
    return out


def prompt(ops, docs=None):
    """Outils du prompt système, en répertoire : une ligne par dossier, les noms des outils (le sujet seul pour les
    dossiers rares) et l'exemple JSON des outils courants. Il ne dépend pas de la demande : llama.cpp le garde lu
    d'une demande à l'autre. Les modes d'emploi complets utiles à une demande arrivent avec elle (relevant), le reste
    s'ouvre (open)."""
    lines = ['Outils, rangés en répertoire outils/<dossier>/<outil> ; ceux utiles à la demande te sont détaillés avec elle. '
             'Pour un autre : {"op":"open","path":"outils/web"} (un dossier) ou "outils/nodes/style" (un outil), lu au tour '
             'suivant. [L] : lecture, résultat au tour suivant.']
    for name, tools in folders(ops).items():
        if name in FOLDED:  # dossier rare : son sujet, à ouvrir
            lines.append(f"outils/{name}/ : {tools[0]['category'].lower()} ({len(tools)} outils)")
        else:
            lines.append(f"outils/{name}/ : " + ', '.join(f"{t['op']}{' [L]' if t.get('read') else ''}" for t in tools))
            lines += [f"  {example(t['op'], docs)}" for t in tools if t['op'] in CORE]
    return '\n'.join(lines)


# Aiguillage : les mots d'une demande (sans accents, en minuscules) qui appellent un dossier d'outils. Local et
# instantané : le Gardien reçoit les modes d'emploi de ce dont il a besoin, sans appel au modèle pour les choisir.
HINTS = {
    'dialogue': ('plus tard', 'rappelle-moi', 'note'),
    'nodes': ('node', 'supprim', 'efface', 'couleur', 'forme', 'carre', 'cercle', 'nettoie', 'vide', 'renomme', 'carte mentale'),
    'liens': ('reli', 'lien', 'connect', 'portail', 'dimension'),
    'navigation': ('montre', 'visite', 'emmene', 'va a', 'va sur', 'zoom', 'focus', 'guide', 'vue d', 'ou est'),
    'gabarits': ('matrice', 'arbre', 'swot', 'schema', 'modele', 'gabarit', 'kanban', 'frise', 'pdca', 'processus', 'organigramme',
                 'ishikawa', 'canvas', 'eisenhower', 'deploie', 'explique'),
    'agents': ('agent', 'redige', 'redaction', 'code', 'programme', 'delegue', 'article'),
    'memoire': ('retiens', 'souviens', 'memoire', 'oublie', 'rappelle-toi', 'mes preferences'),
    'lecture': ('cherche', 'trouve', 'retrouve', 'document', 'lis ', 'inventaire', 'combien'),
    'web': ('web', 'internet', 'google', 'site', 'en ligne', 'actualite', 'url', 'http'),
    'taches': ('tache', 'todo', 'a faire', 'planifie', 'chaque jour', 'tous les', 'rappel'),
    'projets': ('projet', 'mission', 'objectif', 'feuille de route'),
    'competences': ('competence', 'skill', 'savoir-faire'),
    'fichiers': ('fichier', 'git', 'depot', 'enregistre dans'),
    'documents': ('docx', 'word', 'pptx', 'powerpoint', 'presentation', 'diaporama', 'e-mail', 'email', 'mail'),
    'images': ('image', 'dessine', 'illustr', 'photo', 'logo'),
}


def fold(text):
    return unicodedata.normalize('NFD', str(text or '').lower()).encode('ascii', 'ignore').decode()


def focused(text, words):
    """Mode d'emploi raccourci pour une demande : d'une liste « Types et intitulés : a (…), b (…) » (schema), ne garde
    en entier que les types que la demande cite ; les autres, leur nom seul."""
    head, sep, tail = text.partition('Types et intitulés : ')
    if not sep:
        return text
    entries = re.findall(r'(\w+) \(([^)]*)\)', tail)
    kept = [f'{name} ({slots})' for name, slots in entries if name in words]
    others = [name for name, _ in entries if name not in words]
    return head + sep + ', '.join(kept + ([f"autres types : {', '.join(others)}"] if others else [])) + '.'


def relevant(request, ops, docs=None, limit=3):
    """Ce que la demande appelle, joint au message : les dossiers que ses mots évoquent (au plus `limit`) ; dans ces
    dossiers, le mode d'emploi complet des outils que ses mots citent (« kanban » → build), l'exemple seul des
    autres. Vide si rien ne ressort (les exemples du prompt suffisent)."""
    text = fold(request)
    words = set(re.findall(r'[a-z0-9]{4,}', text)) | {w for w in re.findall(r'[a-z0-9]{3}', text) if w in ('bcg', 'bmc', 'why', 'org')}
    tree = folders(ops)
    scored = sorted(((sum(word in text for word in hints), name) for name, hints in HINTS.items() if name in tree),
                    key=lambda item: -item[0])
    chosen = [name for score, name in scored[:limit] if score > 0]
    tools = [t for name in chosen for t in tree[name]]
    hits = {t['op']: sum(word in fold(f"{t['op']} {t['label']} {usage(t['op'], docs)}") for word in words) for t in tools}
    full = sorted((t for t in tools if hits[t['op']]), key=lambda t: -hits[t['op']])[:3]
    lines = []
    for name in chosen:
        for t in tree[name]:
            lines.append(f"{address(t['op'])} : {focused(usage(t['op'], docs), words)}" if t in full else f"  {example(t['op'], docs)}")
    return '\n'.join(lines)


def open_path(path, ops, docs=None):
    """Ce que le Gardien lit en ouvrant une adresse : un outil (mode d'emploi complet), un dossier (ses outils et leur
    exemple) ou « outils » (les dossiers). None si l'adresse n'existe pas ou n'est pas permise."""
    parts = [p for p in str(path or '').strip().split('/') if p]
    if parts and parts[-1] in BY_OP and parts[-1] in ops:
        return f"{address(parts[-1])} : {usage(parts[-1], docs)}"
    tree = folders(ops)
    if parts in ([], ['outils']):
        return 'outils/ : ' + ', '.join(f'{name}/ ({len(tools)})' for name, tools in tree.items())
    if len(parts) == 2 and parts[0] == 'outils' and parts[1] in tree:
        return f"outils/{parts[1]}/ :\n" + '\n'.join(f"- {t['op']} ({t['label']}) : {example(t['op'], docs)}" for t in tree[parts[1]])
    return None
