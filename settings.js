// settings.js
// Handles Data Export, Import, and Configuration Management

document.addEventListener('DOMContentLoaded', () => {
  
  // ==========================================
  // 💾 EXPORT DATA (BACKUP)
  // ==========================================
  const exportBtn = document.getElementById('export-data-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportBtn.textContent = 'Generating...';
      
      // Grab EVERYTHING from local storage
      chrome.storage.local.get(null, (data) => {
        const dataStr = JSON.stringify(data, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        
        // Create a temporary link to trigger the download
        const a = document.createElement('a');
        a.href = url;
        
        // Name the file dynamically based on today's date
        const dateString = new Date().toISOString().split('T')[0];
        a.download = `anilist_extension_backup_${dateString}.json`;
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Visual feedback
        exportBtn.textContent = "✅ Downloaded!";
        exportBtn.style.backgroundColor = 'rgba(61, 180, 242, 0.1)';
        setTimeout(() => {
          exportBtn.textContent = "💾 Backup";
          exportBtn.style.backgroundColor = 'transparent';
        }, 2500);
      });
    });
  }

  // ==========================================
  // 📂 IMPORT DATA (RESTORE)
  // ==========================================
  const importBtn = document.getElementById('import-data-btn');
  const fileInput = document.getElementById('import-file-input');
  
  if (importBtn && fileInput) {
    // Reroute the nice button click to the ugly hidden file input
    importBtn.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          // Parse the uploaded JSON text
          const importedData = JSON.parse(event.target.result);
          
          // Inject it directly into Chrome's storage
          chrome.storage.local.set(importedData, () => {
            importBtn.textContent = "✅ Restored!";
            importBtn.style.backgroundColor = 'rgba(229, 192, 123, 0.1)';
            
            // Reload the popup so the newly injected data takes effect immediately
            setTimeout(() => {
              window.location.reload(); 
            }, 1500);
          });
        } catch (err) {
          console.error("Failed to parse backup file:", err);
          importBtn.textContent = "❌ Invalid File";
          importBtn.style.color = "#e74c3c";
          importBtn.style.borderColor = "#e74c3c";
          
          setTimeout(() => {
            importBtn.textContent = "📂 Restore";
            importBtn.style.color = "#E5C07B";
            importBtn.style.borderColor = "#E5C07B";
          }, 3000);
        }
      };
      
      // Read the file as raw text
      reader.readAsText(file);
    });
  }
  // ==========================================
  // 🔲 GRID VIEW TOGGLE LOGIC
  // ==========================================
  const layoutToggleBtn = document.getElementById('layout-toggle-btn');
  const animeListContainer = document.getElementById('anime-list');
  const searchInput = document.getElementById('search-input');

  if (layoutToggleBtn && animeListContainer) {
    // 1. Load the user's saved preference on boot
    chrome.storage.local.get(['useGridLayout'], (res) => {
      if (res.useGridLayout) {
        animeListContainer.classList.add('grid-layout');
        layoutToggleBtn.textContent = '📄'; // Change icon to List mode
      }
    });

    // 2. Handle button clicks
    layoutToggleBtn.addEventListener('click', () => {
      const isGridNow = animeListContainer.classList.toggle('grid-layout');
      
      // Swap the icon visually
      layoutToggleBtn.textContent = isGridNow ? '📄' : '🔲';
      
      // Save the preference to storage
      chrome.storage.local.set({ useGridLayout: isGridNow });
    });

    // 3. Keep button visibility in sync with the search bar
    if (searchInput) {
      // NEW: Initial state check on boot!
      if (!searchInput.classList.contains('hidden')) {
        layoutToggleBtn.classList.remove('hidden');
      }

      const observer = new MutationObserver(() => {
        if (!searchInput.classList.contains('hidden')) {
          layoutToggleBtn.classList.remove('hidden');
        } else {
          layoutToggleBtn.classList.add('hidden');
        }
      });
      // Watch the search input for class changes
      observer.observe(searchInput, { attributes: true, attributeFilter: ['class'] });
    }
  }
});