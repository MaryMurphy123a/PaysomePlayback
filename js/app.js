// API Endpoints
const UPLOAD = process.env.UPLOAD_ENDPOINT;
const RETRIEVE = process.env.RETRIEVE_ENDPOINT;
const BLOB_ACCOUNT = process.env.BLOB_ACCOUNT;
const COMMENT_STORE = process.env.COMMENT_STORE;
const COMMENT_RETRIEVE = process.env.COMMENT_RETRIEVE;
const RATING_STORE = process.env.RATING_STORE;
const RATING_RETRIEVE = process.env.RATING_RETRIEVE;
const LANGUAGE_ENDPOINT = process.env.LANGUAGE_ENDPOINT;
const LANGUAGE_KEY = process.env.LANGUAGE_KEY;
const REDIS_ENDPOINT = process.env.REDIS_ENDPOINT;
const REDIS_KEY = process.env.REDIS_KEY;

// Helper functions
function encodeFileLocator(fileLocator) {
    if (fileLocator.match(/^[A-Za-z0-9+/=]+$/)) {
        return `"${fileLocator}"`;
    }
    let encoded = encodeURIComponent(fileLocator);
    encoded = encodeURIComponent(encoded);
    return `"${encoded}"`;
}

function getSafeId(fileLocator) {
    return fileLocator.replace(/[^a-zA-Z0-9]/g, '_');
}

// Document ready handlers
$(document).ready(function() {
    $("#retVideos").click(getVideos);
    $("#subNewForm").click(submitNewAsset);
    $('#nameSearch').on('input', filterVideos);
    $('#genreFilter').change(filterVideos);
    testLogicAppConnection();
});

// Video retrieval with Redis caching
function getVideos() {
    $('#VideoList').html('<div class="spinner-border" role="status"><span class="sr-only"> &nbsp;</span>');
    
    $.ajax({
        url: RETRIEVE,
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        success: function(data) {
            window.videoData = data;
            filterVideos();
        },
        error: function(xhr, status, error) {
            console.error("Failed to retrieve videos:", error);
            $('#VideoList').html('Error loading videos. Please try again.');
        }
    });
}

function filterVideos() {
    const nameFilter = $('#nameSearch').val().toLowerCase();
    const genreFilter = $('#genreFilter').val();
    
    const filteredData = window.videoData.filter(video => {
        const nameMatch = video.fileName.toLowerCase().includes(nameFilter);
        const genreMatch = !genreFilter || video.genre === genreFilter;
        return nameMatch && genreMatch;
    });

    displayVideos(filteredData);
}
function submitNewAsset(){
    submitData = new FormData();
    submitData.append('FileName', $('#FileName').val());
    submitData.append('userID', $('#userID').val());
    submitData.append('userName', $('#userName').val());
    submitData.append('description', $('#description').val());
    submitData.append('genre', $('#genre').val());
    submitData.append('ageRating', $('#ageRating').val());
    submitData.append('File', $("#UpFile")[0].files[0]);

    $.ajax({
        url: UPLOAD,
        data: submitData,
        cache: false,
        enctype: 'multipart/form-data',
        contentType: false,
        processData: false,
        type: 'POST',
        success: function(data){
            getVideos();
            $('#newAssetForm')[0].reset();
        },
        error: function(xhr, status, error) {
            console.error("Upload failed:", {
                status: xhr.status,
                statusText: xhr.statusText,
                error: error,
                response: xhr.responseText
            });
            alert("Failed to upload video. Please try again.");
        }
    });
}

function displayVideos(data) {
    var items = [];
    $.each(data, function(key, val) {
        const safeId = getSafeId(val.fileLocator);
        
        items.push("<hr />");
        items.push(`<video width='400' controls><source src='${BLOB_ACCOUNT}${val.filepath}' type='video/mp4'></video><br />`);
        items.push(`File : ${val.fileName}<br />`);
        items.push(`Description: ${val.description}<br />`);
        items.push(`Genre: ${val.genre}<br />`);
        items.push(`Age Rating: ${val.ageRating}<br />`);
        items.push(`Uploaded by: ${val.userName} (user id: ${val.userID})<br />`);
        
        // Rating section
        items.push(`
            <div class="rating-section mt-3">
                <h5>Rate this video</h5>
                <div class="d-flex align-items-center gap-3 mb-2">
                    <div class="stars">
                        ${[1,2,3,4,5].map(star => `
                            <i class="bi bi-star-fill" 
                               id="star-${safeId}-${star}"
                               onclick="submitRating('${val.fileLocator}', ${star})"
                               style="cursor:pointer; color: #ffc107; font-size: 24px;"></i>
                        `).join('')}
                    </div>
                </div>
                <div id="average-rating-${safeId}" class="text-muted small"></div>
            </div>
        `);
        
        // Comment section
        items.push(`
            <div class="comment-section mt-3">
                <h5>Comments</h5>
                <div class="input-group mb-3">
                    <input type="text" class="form-control comment-input" id="comment-${safeId}" placeholder="Add a comment...">
                    <button class="btn btn-primary" onclick="submitComment('${val.fileLocator}')">Post</button>
                </div>
                <div id="comments-${safeId}" class="comments-container">
                    Loading comments...
                </div>
            </div>
        `);
        items.push("<hr />");
    });

    $('#VideoList').empty();
    $("<ul/>", {
        "class": "my-new-list",
        html: items.join("")
    }).appendTo("#VideoList");
    
    data.forEach(video => {
        loadComments(video.fileLocator);
        loadRatings(video.fileLocator);
    });
}

function submitComment(fileLocator) {
    const safeId = getSafeId(fileLocator);
    const commentText = $(`#comment-${safeId}`).val();
    if (!commentText.trim()) return;
    
    $.ajax({
        url: `${LANGUAGE_ENDPOINT}text/analytics/v3.0/sentiment`,
        headers: {
            'Ocp-Apim-Subscription-Key': LANGUAGE_KEY,
            'Content-Type': 'application/json'
        },
        method: 'POST',
        data: JSON.stringify({
            documents: [{
                id: '1',
                text: commentText
            }]
        }),
        success: function(sentimentData) {
            if (sentimentData && sentimentData.documents && sentimentData.documents[0]) {
                const sentiment = sentimentData.documents[0].confidenceScores.positive;
                storeComment(fileLocator, commentText, sentiment);
            } else {
                storeComment(fileLocator, commentText, 0.5);
            }
        },
        error: function(xhr, status, error) {
            console.error("Sentiment analysis failed:", error);
            storeComment(fileLocator, commentText, 0.5);
        }
    });
}

function storeComment(fileLocator, comment, sentiment) {
    const safeId = getSafeId(fileLocator);
    const encodedLocator = fileLocator.match(/^[A-Za-z0-9+/=]+$/) ? 
        fileLocator : encodeFileLocator(fileLocator);
    
    $.ajax({
        url: COMMENT_STORE,
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({
            fileLocator: encodedLocator,
            comment: comment,
            sentiment: sentiment,
            timestamp: new Date().toISOString()
        }),
        success: function(response) {
            $(`#comment-${safeId}`).val('');
            loadComments(fileLocator);
        },
        error: function(xhr, status, error) {
            console.error("Failed to store comment:", error);
            alert("Failed to store comment. Please try again.");
        }
    });
}

function loadComments(fileLocator) {
    if (!fileLocator) return;

    const safeId = getSafeId(fileLocator);
    const baseUrl = COMMENT_RETRIEVE.split('?')[0];
    const existingParams = new URLSearchParams(COMMENT_RETRIEVE.split('?')[1]);
    const encodedLocator = fileLocator.match(/^[A-Za-z0-9+/=]+$/) ? 
        `"${fileLocator}"` : encodeFileLocator(fileLocator);
    
    existingParams.append('fileLocator', encodedLocator);
    const url = `${baseUrl}?${existingParams.toString()}`;

    $(`#comments-${safeId}`).html('<div class="spinner-border" role="status"><span class="sr-only">Loading...</span></div>');

    $.ajax({
        url: url,
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        success: function(comments) {
            if (!Array.isArray(comments)) {
                $(`#comments-${safeId}`).html('Error loading comments');
                return;
            }

            const commentsHtml = comments.map(comment => `
                <div class="comment mb-2 p-2 border-bottom">
                    <p class="mb-1">${escapeHtml(comment.comment)}</p>
                    <small class="text-muted">
                        Sentiment: ${getSentimentLabel(comment.sentiment)} - 
                        ${new Date(comment.timestamp).toLocaleString()}
                    </small>
                </div>
            `).join('');
            
            $(`#comments-${safeId}`).html(commentsHtml || 'No comments yet');
        },
        error: function(xhr, status, error) {
            console.error("Comment load error:", error);
            $(`#comments-${safeId}`).html('Error loading comments. Please try again.');
        }
    });
}

function loadRatings(fileLocator) {
    const safeId = getSafeId(fileLocator);
    const baseUrl = RATING_RETRIEVE.split('?')[0];
    const existingParams = new URLSearchParams(RATING_RETRIEVE.split('?')[1]);
    const encodedLocator = fileLocator.match(/^[A-Za-z0-9+/=]+$/) ? 
        `"${fileLocator}"` : encodeFileLocator(fileLocator);
    
    existingParams.append('fileLocator', encodedLocator);
    const url = `${baseUrl}?${existingParams.toString()}`;
    
    $.ajax({
        url: url,
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        success: function(ratings) {
            const validRatings = ratings.filter(r => {
                const rating = Number(r.rating);
                return !isNaN(rating) && rating >= 1 && rating <= 5;
            });
            
            if (validRatings && validRatings.length > 0) {
                const averageRating = validRatings.reduce((acc, curr) => 
                    acc + Number(curr.rating), 0) / validRatings.length;
                
                $(`#average-rating-${safeId}`).text(
                    `Average rating: ${averageRating.toFixed(1)} out of 5 (${validRatings.length} ${validRatings.length === 1 ? 'rating' : 'ratings'})`
                );
                
                for (let i = 1; i <= 5; i++) {
                    const star = $(`#star-${safeId}-${i}`);
                    if (i <= Math.round(averageRating)) {
                        star.removeClass('bi-star').addClass('bi-star-fill');
                    } else {
                        star.removeClass('bi-star-fill').addClass('bi-star');
                    }
                }
            } else {
                $(`#average-rating-${safeId}`).text('No ratings yet');
            }
        },
        error: function(xhr, status, error) {
            console.error("Rating load error:", error);
            $(`#average-rating-${safeId}`).text('Error loading ratings');
        }
    });
}

function submitRating(fileLocator, rating) {
    const numericRating = Number(rating);
    if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
        console.error("Invalid rating value:", rating);
        return;
    }
    
    const safeId = getSafeId(fileLocator);
    
    for (let i = 1; i <= 5; i++) {
        const star = $(`#star-${safeId}-${i}`);
        if (i <= rating) {
            star.removeClass('bi-star').addClass('bi-star-fill');
        } else {
            star.removeClass('bi-star-fill').addClass('bi-star');
        }
    }
    
    const encodedLocator = fileLocator.match(/^[A-Za-z0-9+/=]+$/) ? 
        fileLocator : encodeFileLocator(fileLocator);
    
    $.ajax({
        url: RATING_STORE,
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({
            fileLocator: encodedLocator,
            rating: numericRating
        }),
        success: function(response) {
            loadRatings(fileLocator);
        },
        error: function(xhr, status, error) {
            console.error("Failed to store rating:", error);
        }
    });
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getSentimentLabel(score) {
    if (score >= 0.6) return 'Positive';
    if (score <= 0.4) return 'Negative';
    return 'Neutral';
}

function testLogicAppConnection() {
    const testFileLocator = "/pawsomevideos/6387125479762237821";
    const baseUrl = COMMENT_RETRIEVE.split('?')[0];
    const existingParams = new URLSearchParams(COMMENT_RETRIEVE.split('?')[1]);
    existingParams.append('fileLocator', encodeFileLocator(testFileLocator));
    
    const url = `${baseUrl}?${existingParams.toString()}`;
    
    $.ajax({
        url: url,
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        success: function(response) {
            console.log("Logic App connection successful:", response);
        },
        error: function(xhr, status, error) {
            console.error("Logic App connection failed:", error);
        }
    });
}