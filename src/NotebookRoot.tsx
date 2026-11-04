import App from './App';
import { I18nProvider } from './i18n';
import { CompanionProvider } from './companion/preferences';
import './fonts.css';
import './theme.css';
import './styles.css';
import './mascot.css';
import './readability.css';
import './free-recording.css';
import './pixel-companion.css';
import './note-inquiry.css';
import './rich-writing.css';
import './whale-companion.css';
import './editor-experience.css';
import './history-experience.css';
import './jingjian.css';
import './planner-experience.css';
import './quill-experience.css';
import './creation-experience.css';

export default function NotebookRoot(){return <I18nProvider><CompanionProvider><App /></CompanionProvider></I18nProvider>;}
