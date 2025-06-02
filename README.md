# Jira Ticket Timer & Resumo

![Versão](https://img.shields.io/badge/version-1.23-blue) ![Licença](https://img.shields.io/badge/license-MIT-green) Uma extensão para Google Chrome que adiciona timers individuais a tickets do Jira, permitindo um melhor gerenciamento de tempo. Inclui um popup para visualizar todos os timers ativos/expirados e gerenciar templates de duração.

## ✨ Funcionalidades

* **Timers Individuais por Ticket**: Inicie um timer para cada ticket do Jira diretamente na página do ticket.
* **Popup de Resumo**:
    * Visualize uma lista de todos os timers atualmente em execução ou expirados.
    * Acesse rapidamente o ticket do Jira correspondente ("Abrir").
    * Pare timers em execução ou limpe timers parados/expirados da lista.
    * Botão para atualizar a lista de timers.
* **Gerenciamento de Templates de Duração**:
    * Crie, nomeie, salve e exclua templates de duração (ex: "Reunião Rápida - 15 min").
    * Acesse a tela de gerenciamento de templates diretamente pelo popup.
* **Aplicação de Templates na Página do Jira**:
    * Um dropdown ao lado dos campos de duração do timer na página do Jira permite aplicar rapidamente um template salvo.
* **Input Flexível de Duração**: Configure a duração do timer usando campos separados para horas, minutos e segundos na página do Jira.
* **Notificações do Navegador**: Receba alertas visuais quando um timer expirar. As notificações não são persistentes e se fecham automaticamente após alguns segundos.
* **Informações Detalhadas**:
    * O nome da cidade (se disponível no campo customizado do Jira) é exibido nas notificações e na lista de timers ativos no popup.
    * O título do ticket também é exibido para fácil identificação.
* **Temas Claro e Escuro**:
    * Interface do popup e do painel do timer na página do Jira com suporte a tema claro e escuro.
    * Sincronização do tema entre o popup e o painel na página.
* **Badge Indicadora**: O ícone da extensão mostra um badge com o número de timers ativos ou expirados.
* **Persistência e Sincronização**:
    * Timers e templates são salvos no `chrome.storage.local`.
    * O estado dos timers e os alarmes são revalidados ao iniciar o navegador ou instalar/atualizar a extensão.

## 🛠️ Tecnologias Utilizadas

* JavaScript (ES6+)
* HTML5
* CSS3
* APIs de Extensão do Google Chrome:
    * `storage`
    * `alarms`
    * `notifications`
    * `tabs`
    * `action`
    * `runtime`
    * `scripting`

## 🚀 Instalação

### Opção 1: Pela Chrome Web Store (Recomendado quando publicada)

* (Link para a extensão na Chrome Web Store - adicione quando estiver publicada)

### Opção 2: Manualmente (para desenvolvimento ou uso local)

1.  Clone este repositório ou baixe o código-fonte como ZIP e extraia-o.
    ```bash
    git clone [https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git](https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git)
    ```
2.  Abra o Google Chrome e navegue até `chrome://extensions`.
3.  Habilite o "Modo do desenvolvedor" no canto superior direito.
4.  Clique em "Carregar sem compactação".
5.  Selecione o diretório raiz da extensão (a pasta que contém o arquivo `manifest.json`).
6.  A extensão deverá aparecer na lista e estar pronta para uso.

## 📖 Como Usar

### Na Página de um Ticket do Jira

1.  **Painel do Timer**: Ao abrir a página de um ticket do Jira (ex: `/browse/PROJETO-123`), um painel do timer aparecerá (geralmente abaixo do título do ticket ou acima da seção de atividades/comentários).
2.  **Configurar Duração**:
    * Insira manualmente as horas, minutos e segundos nos campos de input.
    * Ou, selecione um template de duração previamente salvo no dropdown "Aplicar template..." ao lado do status do timer.
3.  **Iniciar/Parar**:
    * Clique no botão "Iniciar" para começar a contagem. O botão mudará para "Parar".
    * Clique em "Parar" para pausar o timer. O botão voltará para "Iniciar", e os campos de duração manterão o valor original configurado.
4.  **Status do Timer**: O texto ao lado do botão indicará o estado atual: "Timer parado", a contagem regressiva, ou "Expirado! Excedido há: HH:MM:SS".

### Popup da Extensão

1.  **Abrir o Popup**: Clique no ícone da extensão Jira Ticket Timer & Resumo na barra de ferramentas do Chrome.
2.  **Visualizar Timers**:
    * Uma lista de todos os timers ativos ou expirados será exibida.
    * Cada item mostra:
        * Chave do Ticket (ex: `PROJETO-123`)
        * Nome da Cidade (se disponível, ex: `(São Paulo)`)
        * Título do Ticket (resumido se for longo)
        * Tempo restante (para timers ativos) ou tempo excedido (para timers expirados).
3.  **Ações por Timer**:
    * **Abrir**: Abre o ticket correspondente em uma nova aba do Jira.
    * **Parar**: (Apenas para timers ativos) Para o timer.
    * **Limpar**: (Apenas para timers parados ou expirados) Remove o timer da lista e do armazenamento da extensão. **Importante**: Isso resetará o painel do timer na página do Jira correspondente para o estado inicial.
4.  **Atualizar Lista**: Clique no botão "Atualizar Lista" para buscar o estado mais recente de todos os timers.
5.  **Gerenciar Templates**:
    * Clique em "Gerenciar Templates de Duração". A visualização do popup mudará.
    * **Criar Template**:
        * Insira um "Nome do Template".
        * Defina a duração em Horas, Minutos e Segundos.
        * Clique em "Salvar Template".
    * **Visualizar/Excluir Templates**:
        * A lista de templates salvos é exibida com nome e duração.
        * Clique no botão "Excluir" ao lado de um template para removê-lo.
    * **Voltar**: Clique em "Voltar aos Timers" para retornar à lista de timers ativos.
6.  **Alternar Tema**: Clique no ícone de lua (🌙) ou sol (☀️) no canto superior direito do popup para alternar entre os temas claro e escuro. O tema também será aplicado ao painel do timer na página do Jira.

## ⚙️ Estrutura de Pastas do Projeto (Resumida)

```
.
├── background/
│   └── background.js        # Lógica de fundo, alarmes, notificações
├── content_scripts/
│   ├── jira_content_timer.css # Estilos para o painel na página do Jira
│   └── jira_content_timer.js  # Lógica do painel na página do Jira
├── icons/
│   └── icon128.png          # Ícone da extensão
├── popup/
│   ├── popup.css            # Estilos do popup
│   ├── popup.html           # Estrutura HTML do popup
│   └── popup.js             # Lógica do popup (timers ativos, gerenciamento de templates)
└── manifest.json            # Arquivo de manifesto da extensão
```

## 🖼️ Screenshots

*(Adicione aqui screenshots da extensão em uso. Por exemplo:*
* *Painel do timer na página do Jira.*
* *Popup mostrando a lista de timers ativos.*
* *Popup na visualização de gerenciamento de templates.*
* *Exemplo de notificação do navegador.*
* *Dropdown de templates na página do Jira.)*

## 📜 Licença

Este projeto é distribuído sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes (se você adicionar um).
*(Ou substitua MIT pela licença de sua escolha)*

---

Sinta-se à vontade para ajustar a versão, o nome do repositório no comando `git clone`, a licença e adicionar seus próprios screenshots!
