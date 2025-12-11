// Client-side code to fetch and display formation data for activities
// Add this to your map page if needed

async function fetchFormationForActivity(activityId, apiNumber) {
  try {
    const response = await fetch(`/api/formation-for-activity?id=${activityId}&api=${apiNumber}`);
    const data = await response.json();
    
    if (data.formation) {
      // Update the UI with the formation data
      const formationElement = document.querySelector(`[data-activity-id="${activityId}"] .formation`);
      if (formationElement) {
        formationElement.textContent = data.formation;
      }
      
      console.log(`Formation updated for activity ${activityId}: ${data.formation}`);
      return data.formation;
    }
  } catch (error) {
    console.error('Error fetching formation:', error);
  }
  return null;
}

// Example usage in a popup:
// When showing a completion activity popup, if formation is missing:
// const formation = await fetchFormationForActivity(activity.id, activity.fields['API Number']);