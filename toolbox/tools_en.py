"""Le catalogue d'outils (tools.py) en anglais : famille, nom et mode d'emploi de chaque outil, pour un compte en
anglais (maison du Gardien, liste des outils d'Agents & modèles). Les exemples JSON gardent leurs clés et leur op ;
les adresses du répertoire (outils/<famille>/<op>) restent celles du catalogue français."""

CATEGORIES = {
    'Administrateur': 'Administrator', 'Agents': 'Agents', 'Compétences': 'Skills', 'Dialogue': 'Dialogue',
    'Documents et e-mail': 'Documents and e-mail', 'Fichiers et git': 'Files and git', 'Gabarits': 'Templates', 'Images': 'Images',
    'Lecture': 'Reading', 'Liens et dimensions': 'Links and dimensions', 'Mémoire': 'Memory', 'Navigation': 'Navigation',
    'Nodes': 'Nodes', 'Projets et missions': 'Projects and missions', 'Rappels': 'Reminders', 'Tâches': 'Tasks', 'Web': 'Web',
}

TOOLS = {
    'ask': ("Ask the human a question",
            '{"op":"ask","text":"A tree or a matrix?","choices":["Tree","Matrix"]} : if the request is ambiguous, ONE short question with 2 to 4 '
            "choices; the human answers with a click and the answer arrives as a new message. Don't add any other action with it."),
    'note': ('Leave a note (correspondence)',
             '{"op":"note","text":"I noticed that…","choices":["Yes","Later"]} : a note for later, placed in the Guardian dimension, under '
             "Exchanges; the human answers in a linked node, and you read the answer on the next requests."),
    'remind': ('Set, move or remove a reminder',
               '{"op":"remind","ref":"N-12","at":"2026-10-09 09:00"} : reminder on a node, in the human\'s time (YYYY-MM-DD HH:MM, computed '
               'from "Now"); the node counts down and the human is notified when it is due. With no fitting node: "text":"Call Paul" '
               'without ref creates the reminder node. "at":"" removes the reminder. A node of another dimension is cited by its N- '
               '(reminders or search_nodes gives it).'),
    'reminders': ('List the reminders',
                  '{"op":"reminders"} : all the human\'s reminders, all dimensions, nearest first, with their node and due time.'),
    'put': ('Write a node (whole object)',
            '{"op":"put","ref":"new1","near":"N-3","text":"...","color":"#4D96FF","shape":"square","links":["N-3"],"children":["a","b"]} : '
            'the node as you read it: new (new1) or existing (N-12); text, look, links and children in one action, only the given '
            'fields change.'),
    'create': ('Create a node',
               '{"op":"create","ref":"new1","text":"...","near":"N-3","color":"#4D96FF","shape":"circle"} : new node placed near `near`; '
               'color and shape optional.'),
    'update': ('Rewrite a node', '{"op":"update","ref":"N-2","text":"..."} : replaces the text of a node.'),
    'style': ('Look (color, shape, size, lock)',
              '{"op":"style","ref":"N-2","color":"#FF6B6B","shape":"square","radius":90,"lock":true} : look (shapes: circle, square, none; '
              'size 20 to 400; lock prevents moving it).'),
    'set_type': ('Node type (text, image, file, drawing)',
                 '{"op":"set_type","ref":"N-2","content_type":"canvas"} : node type (text, image, file, canvas = drawing).'),
    'archive': ('Delete a node', '{"op":"archive","ref":"N-4"} : deletes a node (undoable with Ctrl+Z).'),
    'cleanup': ('Clear out empty nodes', '{"op":"cleanup"} : deletes the empty nodes of the plane.'),
    'mindmap': ('Mind map',
                '{"op":"mindmap","ref":"new1","text":"Topic","children":["idea 1","idea 2"],"near":"N-3"} : mind map, a central node (new '
                'or existing) surrounded by its ideas, all linked to it.'),
    'link': ('Link two nodes', '{"op":"link","source":"N-1","target":"new1"} : creates a link.'),
    'unlink': ('Detach two nodes', '{"op":"unlink","source":"N-1","target":"N-2"} : removes a link.'),
    'portal': ('Portal to a new dimension',
               '{"op":"portal","ref":"N-2","name":"Research"} : teleports N-2 into a new dimension `name`, linked by a portal.'),
    'focus': ('Camera move to a node',
              '{"op":"focus","ref":"N-2","zoom":1.5,"text":"caption"} : camera move to a node then caption. Chain several focus for a guided '
              'tour or a tutorial.'),
    'overview': ('Overview', '{"op":"overview","text":"..."} : steps back to show the whole plane.'),
    'travel': ('Travel to a dimension', '{"op":"travel","name":"<dimension>","text":"..."} : travels to another dimension.'),
    'tour': ('Interactive tour of a branch',
             '{"op":"tour","ref":"N-3"} : starts the interactive tour from N-3: the camera follows the links, the user picks the branch at '
             'each fork, sets the speed, pauses. For "show me around…".'),
    'goto': ('Go to a found node',
             '{"op":"goto","ref":"N-45","text":"caption"} : travels to a node found by search_nodes, even in another dimension.'),
    'build': ('Build a template (matrix, kanban, timeline…)',
              '{"op":"build","layout":"matrix","title":"Eisenhower","rows":["Urgent","Not urgent"],"cols":["Important","Secondary"],'
              '"cells":[["Do","Delegate"],["Schedule","Drop"]],"near":"N-3","color":"#6848A6","save_as":"eisenhower"} : builds a structure '
              'of nodes in a free corner. layout: matrix (rows, cols, cells[row][column]), kanban (cols, cells[column] = cards), timeline '
              '(items in order), pyramid (items from top to base), tree (items: one line per node, 2 spaces of indentation per level), '
              'list (items). {"op":"build","template":"eisenhower","cells":[...]} reuses a kept template; save_as keeps it.'),
    'grow': ('Grow a line of thought (organic structure)',
             '{"op":"grow","near":"N-3","text":"Central idea\\n- Branch: detail\\n  - sub-idea\\n- Another branch"} : for a long line of '
             'thought or an explanation: write a free outline, one idea per line, indented (2 spaces, bullets or #); it grows as a star, '
             'one color per branch, 80 ideas at most. With "ref":"N-12", it grows around that node.'),
    'template_save': ('Keep a template',
                      '{"op":"template_save","name":"retro","layout":"kanban","title":"Retrospective","cols":["Good","To improve","Actions"],'
                      '"description":"team retro"} : keeps a template to build it again later (build with template).'),
    'templates': ('Kept templates', '{"op":"templates"} : lists the kept templates (name, shape, description).'),
    'template_delete': ('Forget a template', '{"op":"template_delete","name":"retro"} : forgets a kept template.'),
    'schema': ('Known gallery template (SWOT, Ishikawa…)',
               '{"op":"schema","type":"swot","near":"N-3","title":"My project","fill":{"Strengths":["idea","idea"],"Threats":"Competition"}} : '
               'places a gallery template, made of nodes and links, already filled in. title: the central node. fill: title of a box → a '
               'text (the box changes text) or a list of ideas (placed around it, instead of the examples). Types and titles: swot '
               '(Strengths, Weaknesses, Opportunities, Threats), eisenhower (Do, Schedule, Delegate, Drop), bcg (Stars, Question marks, '
               'Cash cows, Dogs), pestel (Political, Economic, Social, Technological, Environmental, Legal), porter (New entrants, Supplier '
               'power, Substitutes, Buyer power), smart (Specific, Measurable, Achievable, Realistic, Time-bound), organic (Why, Who, How, '
               'When, Risks), org (Division 1, Division 2, Division 3), decision (Option A, Option B), family (Father, Mother), bmc (Key '
               'partners, Key activities, Key resources, Value proposition, Customer relationships, Channels, Customer segments, Cost '
               'structure, Revenue streams), ikigai (What you love, What you are good at, What the world needs, What you can be paid for, '
               'Passion, Mission, Profession, Vocation), ansoff (Penetration, Product development, Market development, Diversification), '
               'tows (SO: attack, WO: strengthen, ST: defend, WT: avoid), m3x3 (Row 1…3, Column 1…3), ishikawa (Manpower, Methods, '
               'Machines, Materials, Environment, Measurement), kanban (To do, Doing, Done), timeline (2024, 2025, 2026, 2027), pdca (Plan, '
               'Do, Check, Act), process (Step 1, Step 2, Step 3), design (Empathise, Define, Ideate, Prototype, Test), aida (Attention, '
               'Interest, Desire, Action), maslow (Physiological, Safety, Belonging, Esteem, Self-actualisation), why (Problem, Root cause).'),
    'delegate': ('Hand over to an agent',
                 '{"op":"delegate","agent":"<name>","task":"precise instruction","ref":"new1 or N-2","near":"N-1"} : hands the production to '
                 'an agent; its result is published in the node `ref` (created if new). For an image agent (Illustrator), `task` is a '
                 'precise image prompt in English (subject, style, light, framing): the image is placed in the node `ref`. Without an '
                 'image model, the image agent draws itself: "mode":"vector" (clean vector drawing, by default) or "mode":"sketch" '
                 "(sketch traced on the node's canvas)."),
    'plug_agent': ('Plug a model into an agent',
                   '{"op":"plug_agent","agent":"<name>","model":"<part of the model name>"} : plugs a model into an agent.'),
    'create_agent': ('Create an agent',
                     '{"op":"create_agent","name":"Translator","role":"text","description":"...","prompt":"instructions","model":"qwen"} : '
                     'creates a specialised agent (roles: text, code, tools).'),
    'update_agent': ('Tune an agent',
                     '{"op":"update_agent","agent":"<name>","description":"...","prompt":"...","enabled":false} : changes its instructions '
                     'or turns it on / off.'),
    'remember': ('Remember', '{"op":"remember","text":"lasting fact about the user or their projects"} : you will find it on every request.'),
    'forget': ('Forget', '{"op":"forget","text":"..."} : forgets the memories that contain this text.'),
    'inventory': ('Inventory (dimensions, agents, models)', '{"op":"inventory"} : dimensions, agents and models.'),
    'search_nodes': ('Search all nodes',
                     '{"op":"search_nodes","query":"words"} : searches all of the user\'s nodes, all dimensions.'),
    'read_file': ('Read a document',
                  '{"op":"read_file","ref":"N-7"} : text of the document of a file node; {"op":"read_file","path":"notes/plan.md"} : file '
                  'of the workspace.'),
    'web_search': ('Web search',
                   '{"op":"web_search","query":"..."} : searches the web; cite your sources (address) in the nodes you create.'),
    'web_fetch': ('Read a web page', '{"op":"web_fetch","url":"https://..."} : reads a public page.'),
    'create_task': ('Create a task',
                    '{"op":"create_task","title":"...","description":"...","acceptance_criteria":"2 to 4 checkable criteria","project":"NAME",'
                    '"agent":"<name>","priority":"medium","run":true} : task in the register; run hands the task to its agent right away '
                    '(in the background).'),
    'list_tasks': ('List the tasks',
                   '{"op":"list_tasks","status":"planned","project":"NAME"} : tasks (optional filters), with their result.'),
    'update_task': ('Update a task',
                    '{"op":"update_task","task_id":"task_0001","field":"status","value":"completed"} : fields title, description, status '
                    '(planned, in_progress, completed, failed), priority (low, medium, high, critical), agent, progress (notes the step), '
                    'result.'),
    'delete_task': ('Delete a task', '{"op":"delete_task","task_id":"task_0001"} : removes the task from the register.'),
    'schedule_task': ('Recurring task',
                      '{"op":"schedule_task","action":"create","expr":"daily@08:30","title":"...","agent":"<name>"} : task that comes back '
                      '(daily@HH:MM, weekly:mon@HH:MM, hourly, every:30m); action list, delete, enable, disable with '
                      '"schedule_id":"sched_0001".'),
    'create_project': ('Create a project',
                       '{"op":"create_project","name":"NAME","vision":"goal in one paragraph"} : project with its memory, and a dimension '
                       'of the same name.'),
    'list_projects': ('List the projects', '{"op":"list_projects"} : projects, status and task progress.'),
    'plan_project': ('Planning context',
                     '{"op":"plan_project","goal":"goal in the user\'s words","project":"NAME"} : vision, memory, agents, open tasks and '
                     'skills, to split the goal into tasks.'),
    'update_project': ('Update a project',
                       '{"op":"update_project","project_name":"NAME","field":"vision","new_value":"..."} : fields name, vision, status '
                       '(active, archived), assign_agent, unassign_agent.'),
    'update_project_memory': ('Project memory',
                              '{"op":"update_project_memory","project_name":"NAME","kind":"decision","content":"..."} : kind achievement, '
                              'decision, blocker, resolve_blocker, next_steps, agent_sync.'),
    'read_project_memory': ("Read a project's memory",
                            '{"op":"read_project_memory","project_name":"NAME"} : vision, achievements, decisions, blockers, next steps.'),
    'audit_project': ('Audit a project',
                      '{"op":"audit_project","project_name":"NAME"} : task progress, empty or isolated nodes of its dimension, blockers, '
                      'next steps.'),
    'launch_mission': ('Autonomous mission',
                       '{"op":"launch_mission","goal":"checkable goal","project":"NAME","budget":3} : plans, hands over to the agents, '
                       'audits and starts again in the background, at most `budget` rounds.'),
    'mission_status': ('Mission tracking',
                       '{"op":"mission_status","mission_id":"mission_0001","abort":false} : without an id, the recent missions; abort '
                       'stops it.'),
    'write_skill': ('Write a skill',
                    '{"op":"write_skill","skill_id":"guided_tour","name":"...","summary":"...","steps":["step 1","step 2"],"triggers":"when…"} : '
                    'reusable recipe (new version if it exists).'),
    'list_skills': ('List the skills', '{"op":"list_skills"} : skills, steps and success rate.'),
    'delete_skill': ('Delete a skill', '{"op":"delete_skill","skill_id":"..."} : removes a wrong or outdated skill.'),
    'record_skill_outcome': ('Rate a skill',
                             '{"op":"record_skill_outcome","skill_id":"...","outcome":"success"} : success, partial or fail, after use.'),
    'read_my_brain': ('Read my brain',
                      '{"op":"read_my_brain","section_path":"skills.guided_tour"} : sections guidelines, memory, tools_catalog, skills, '
                      'current_state, and your free fields.'),
    'update_brain_field': ('Change my brain',
                           '{"op":"update_brain_field","field_path":"style.tone","value":"..."} : guidelines replaces your instructions, '
                           'memory adds a memory, any other path is a free field (JSON accepted).'),
    'update_user_context': ('User context', '{"op":"update_user_context","text":"..."} : like remember.'),
    'get_logs': ('Log', '{"op":"get_logs","limit":20,"event_type":"task_created"} : your last recorded actions.'),
    'write_file': ('Write a file',
                   '{"op":"write_file","path":"notes/plan.md","content":"..."} : workspace file (folders created when needed).'),
    'list_files': ('List files', '{"op":"list_files","path":"."} : content of a workspace folder.'),
    'edit_file': ('Edit a file',
                  '{"op":"edit_file","path":"...","search_text":"text present only once","replace_text":"..."} : targeted replacement.'),
    'git': ('Git',
            '{"op":"git","action":"status"} : status, diff (optional path), log, commit (message, optional files) in the workspace.'),
    'generate_docx': ('Word document',
                      '{"op":"generate_docx","filename":"report","title":"...","markdown":"# Title\\n- point","template":"<docx template>"} : '
                      "downloadable .docx; template: one of the user's document templates (their style), optional."),
    'generate_xlsx': ('Excel workbook',
                      '{"op":"generate_xlsx","filename":"budget","title":"...","rows":[["Item","Amount"],["Rent",900]],"template":"<xlsx '
                      'template>"} : downloadable .xlsx; with a template, the rows are added under its headers.'),
    'generate_pdf': ('PDF',
                     '{"op":"generate_pdf","filename":"quote","title":"...","markdown":"# Title\\n- point","template":"<pdf template>"} : '
                     'downloadable .pdf; with a template, each page is laid on its first page (letterhead).'),
    'generate_pptx': ('Presentation',
                      '{"op":"generate_pptx","filename":"pitch","title":"...","slides":[{"title":"...","bullets":["..."]}],"template":"<pptx '
                      'template>"} : downloadable .pptx; with a template, its theme, fonts and layouts.'),
    'send_email': ('Send an e-mail',
                   '{"op":"send_email","subject":"...","body":"..."} : to the user\'s address (an administrator can give "to").'),
    'generate_image': ('Generate an image',
                       '{"op":"generate_image","prompt":"prompt in English","ref":"new1","near":"N-1","mode":"vector|sketch"} : the image '
                       'agent draws in a node (FLUX / SD if installed, otherwise vector drawing or sketch).'),
    'draw': ('Draw yourself (sketch or vector)',
             '{"op":"draw","prompt":"what to draw, precise","ref":"new1","near":"N-1","mode":"sketch|vector"} : you draw yourself: '
             "sketch, a line sketch on the node's canvas; vector, a vector drawing as an image."),
    'edit_image': ('Retouch an image',
                   '{"op":"edit_image","ref":"N-5","prompt":"what changes","strength":0.6} : img2img on an image node; strength from 0 '
                   '(close) to 1 (free).'),
    'list_agents': ('List the agents', '{"op":"list_agents"} : agents, roles, models and descriptions.'),
    'list_models': ('List the models', '{"op":"list_models"} : models of the library and their state.'),
    'dispatch_to_agent': ('Hand over (iAqua)', '{"op":"dispatch_to_agent","agent":"<name>","task":"...","ref":"new1"} : like delegate.'),
    'update_agent_field': ('Agent field',
                           '{"op":"update_agent_field","agent":"<name>","field_path":"prompt","new_value":"..."} : description, prompt, '
                           'enabled, model.'),
    'delete_agent': ('Delete an agent',
                     '{"op":"delete_agent","agent":"<name>"} : irreversible; only if the user asks for it, naming the agent.'),
    'execute_bash': ('Shell', '{"op":"execute_bash","command":"ls -la","cwd":".","timeout":30} : command in the workspace.'),
    'pyenv': ('Python environment',
              '{"op":"pyenv","action":"install","packages":["pandas"]} : install, list, remove in the dedicated Python environment.'),
    'forge_tool': ('Forge a tool',
                   '{"op":"forge_tool","action":"create","name":"converter","description":"...","code":"import json,sys\\ndata=json.load(sys.stdin)'
                   '\\nprint(json.dumps(...))","test_input":"{}"} : Python script tested then saved; list, delete, enable, disable.'),
    'run_tool': ('Use a forged tool', '{"op":"run_tool","name":"converter","input":{"...":"..."}} : runs a forged tool.'),
    'list_mcp_servers': ('MCP servers', '{"op":"list_mcp_servers"} : configured MCP servers (MCP_SERVERS).'),
    'call_mcp_tool': ('MCP tool',
                      '{"op":"call_mcp_tool","server":"name","name":"tools/list","arguments":{}} : tools/list to discover, then the name of '
                      'the tool.'),
    'open': ('Open an address of the tool directory',
             '{"op":"open","path":"outils/nodes/style"} : full instructions of a tool; a folder ("outils/web") lists its tools with their '
             'example; "outils" lists the folders. Several at once: "paths":[...].'),
    'tool_help': ('Tool instructions', '{"op":"tool_help","names":["create_task","launch_mission"]} : detailed instructions of the named tools.'),
}


def tool(op, lang):
    """Nom, famille et mode d'emploi d'un outil dans la langue `lang` (le catalogue français sinon)."""
    from .tools import BY_OP

    base = BY_OP[op]
    if lang != 'en' or op not in TOOLS:
        return {'label': base['label'], 'category': base['category'], 'doc': base['doc']}
    label, doc = TOOLS[op]
    return {'label': label, 'category': CATEGORIES.get(base['category'], base['category']), 'doc': doc}
